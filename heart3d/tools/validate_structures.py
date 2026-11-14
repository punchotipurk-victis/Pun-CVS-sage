#!/usr/bin/env python3
"""Validate structure cards and references against the model's source data.

No browser or third-party package is required. With jsonschema installed the
official validator is used; otherwise the schema subset used by cards is checked.
"""
import argparse
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def schema_errors(value, rule, schema, path='$'):
    """Fallback for all schema keywords used in structures.schema.json."""
    if '$ref' in rule:
        target = schema
        for key in rule['$ref'].split('/')[1:]:
            target = target[key]
        yield from schema_errors(value, target, schema, path)
        return
    types = {'object': dict, 'array': list, 'string': str, 'null': type(None)}
    expected = rule.get('type')
    if expected and not any(isinstance(value, types[t]) for t in ([expected] if isinstance(expected, str) else expected)):
        yield f'{path}: expected {expected}'
        return
    if 'enum' in rule and value not in rule['enum']:
        yield f'{path}: invalid enum value {value!r}'
    if isinstance(value, str):
        if len(value) > rule.get('maxLength', float('inf')):
            yield f'{path}: exceeds maxLength {rule["maxLength"]}'
        if 'pattern' in rule and not re.search(rule['pattern'], value):
            yield f'{path}: invalid format'
    if isinstance(value, list):
        if not rule.get('minItems', 0) <= len(value) <= rule.get('maxItems', float('inf')):
            yield f'{path}: invalid item count'
        for i, item in enumerate(value):
            yield from schema_errors(item, rule.get('items', {}), schema, f'{path}[{i}]')
    if isinstance(value, dict):
        for key in rule.get('required', []):
            if key not in value:
                yield f'{path}: missing {key}'
        props = rule.get('properties', {})
        for key, item in value.items():
            if key in props:
                yield from schema_errors(item, props[key], schema, f'{path}.{key}')
            elif rule.get('additionalProperties') is False:
                yield f'{path}: unexpected property {key}'


# Read top-level keys of the small JS constant tables without evaluating code.
# Strings/comments are single tokens, so braces in teaching text cannot end a table.
TOKENS = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]')


def table_keys(path, name):
    source = (ROOT / path).read_text(encoding='utf-8')
    match = re.search(r'\bconst\s+' + re.escape(name) + r'\s*=\s*\{', source)
    if not match:
        raise ValueError(f'{path}: cannot find table {name}')
    tokens = [t for t in TOKENS.findall(source[match.end():]) if not t.startswith(('//', '/*'))]
    depth, keys = 0, set()
    for i, token in enumerate(tokens):
        if token == '}' and depth == 0:
            break
        if depth == 0 and i + 1 < len(tokens) and tokens[i + 1] == ':' and (token[0].isalpha() or token[0] in '_$\"\x27'):
            keys.add(token.strip('\"\x27'))
        if token in ('{', '[', '('):
            depth += 1
        elif token in ('}', ']', ')'):
            depth -= 1
    return keys


def namespaces():
    phantom = (ROOT / 'echo-sim/src/engine/phantom.js').read_text(encoding='utf-8')
    labels = set(json.loads(re.search(r'const LABELS\s*=\s*(\[[\s\S]*?\]);', phantom)[1])) - {''}
    landmarks = set(load('echo-sim/export/heart-landmarks.json')['landmarks'])
    mesh = load('echo-sim/export/heart-mesh.json')
    vessels = {prefix + v['id'] for kind, prefix in [('arteries', 'artery:'), ('veins', 'vein:')] for v in mesh['vessels'][kind]}
    conduction = {'conduction:' + key for key in load('heart3d/data/conduction.json')['display']['pick']['taps'] if not key.startswith('_')}
    data_js = 'heart3d/src/js/explore-data.js'
    extras = set().union(*(table_keys(data_js, key) for key in ('CARD', 'NOTE', 'LEAFLET', 'VALVE_GROUPS')))
    real = labels | landmarks | vessels | conduction | extras
    # Only labels actually used by heart geometry count toward model coverage.
    interior = load('echo-sim/export/heart-interior.json')
    model = extras | vessels | conduction
    for names, encoded in [(mesh['labelNames'], mesh['vertex']['label']),
                           (interior['labelNames'], interior['tissue']['vertex']['label']),
                           (interior['labelNames'], interior['tissue']['vertex']['cavity'])]:
        model.update(names[i] for i in set(base64.b64decode(encoded)))
    for valve in interior['valves']['items']:
        model.update(valve['labels'])
    model.discard('')
    echo = {view['id'] for view in load('echo-sim/data/views.json')['views']}
    cuts = table_keys('heart3d/src/js/explore.js', 'CUTS')
    scenarios = table_keys('heart3d/src/js/content.js', 'SC') | table_keys('heart3d/src/js/patho-content.js', 'EXTRA') | table_keys('heart3d/src/js/patho-content.js', 'MIS')
    return real, model, echo, cuts, scenarios


def validate(data, builtin=False):
    schema = load('heart3d/data/structures.schema.json')
    try:
        if builtin:
            raise ImportError
        from jsonschema import Draft202012Validator
        errors = [f'{e.json_path}: {e.message}' for e in Draft202012Validator(schema).iter_errors(data)]
    except ImportError:
        errors = list(schema_errors(data, schema, schema))
    if errors:
        return errors, 0, set()
    real, model, echo, cuts, scenarios = namespaces()
    owners, ids = {}, set()
    for card in data['cards']:
        cid = card['id']
        if cid in ids:
            errors.append(f'duplicate card id: {cid}')
        ids.add(cid)
        # A part may also occur in its own parent's labelIds; it still has one owner.
        taps = set(card['labelIds']) | {p['labelId'] for p in card.get('parts', []) if p.get('labelId')}
        for tap in taps:
            if tap in owners:
                errors.append(f'{tap}: belongs to both {owners[tap]} and {cid}')
            owners[tap] = cid
            if tap not in real:
                errors.append(f'{cid}: unknown tap id {tap}')
        for item in card['quick'] + card.get('relations', []):
            for focus in item.get('focus', []):
                if focus not in real:
                    errors.append(f'{cid}: unknown focus id {focus}')
        for kind, valid in [('echo', echo), ('cut', cuts)]:
            for ref in card.get('seenOn', {}).get(kind, []):
                if 'id' in ref and ref['id'] not in valid:
                    errors.append(f'{cid}: unknown {kind} id {ref["id"]}')
        for complication in card['complications']:
            key = complication['scenario']
            if key is not None and key not in scenarios and not (key.startswith('planned:') and key[8:]):
                errors.append(f'{cid}: unknown scenario {key}')
    return errors, len(owners), model - set(owners)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('path', nargs='?', default=str(ROOT / 'heart3d/data/structures.json'))
    ap.add_argument('--builtin', action='store_true', help='exercise the dependency-free schema checker')
    args = ap.parse_args()
    try:
        data = json.loads(Path(args.path).read_text(encoding='utf-8'))
        errors, taps, uncovered = validate(data, args.builtin)
        print(f'{len(data.get("cards", []))} card(s), {taps} tap id(s), {len(errors)} error(s)')
        if taps:
            model = namespaces()[1]
            print(f'Coverage: {len(model) - len(uncovered)} model tap id(s) with a card / {len(uncovered)} without (informative only)')
            if uncovered:
                print('Without: ' + ', '.join(sorted(uncovered)))
        for error in errors:
            print('  ' + error)
        return 1 if errors else 0
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f'Validation error: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
