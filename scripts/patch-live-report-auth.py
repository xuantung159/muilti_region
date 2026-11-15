from pathlib import Path
import hashlib, sys
root = Path(sys.argv[1])
kind = sys.argv[2]
p = root / kind / 'index.mjs'
s = p.read_text()
expected = {'monitoring': '872f5d77b4e96f383b62104ad1228e86777cd027a295d7bd934e41d55287e50c', 'dashboard': '29698ac129534f6d92ca10f83a0f26aac84c9b0105e82c451d9a19a044843f58'}
assert hashlib.sha256(p.read_bytes()).hexdigest() == expected[kind], 'Live backup changed; inspect before patching'
def change(old,new):
 global s
 assert s.count(old) == 1, f'Expected one anchor: {old!r}'
 s=s.replace(old,new)
if kind == 'monitoring':
 change("import { CloudWatchClient,", "import { authorizeReport } from './report-auth.mjs';\nimport { CloudWatchClient,")
 change('async (event, service) => {','async (event, service, authorize = authorizeReport) => {')
 change('return respond(200, await service[name](range));', 'const denied = await authorize(event);\n    if (denied) return respond(denied.status, { error: denied.error, code: denied.code });\n    return respond(200, await service[name](range));')
else:
 change('const HEALTH_CHECK_PREFIX = `${process.env.PROJECT}-hc-`;', "const HEALTH_CHECK_IDS = { 'ap-southeast-1': 'c7764d38-b17d-44df-8d44-4f2791296adc', 'ap-northeast-1': 'bfa2df95-4abf-40d2-a240-dbd04acf735c' };")
 change('    const { HealthChecks = [] } = await route53.send(new ListHealthChecksCommand({}), options);\n    const checks = HealthChecks.filter((check) => check.CallerReference?.startsWith(HEALTH_CHECK_PREFIX));', '    const checks = Object.entries(HEALTH_CHECK_IDS).map(([region, Id]) => ({ region, Id }));')
 change('check.CallerReference.slice(HEALTH_CHECK_PREFIX.length)', 'check.region')
p.write_text(s)
print(kind, hashlib.sha256(p.read_bytes()).hexdigest())
