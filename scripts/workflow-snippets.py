"""Generate source-derived code for every UML step; no runtime dependencies."""
from pathlib import Path
from html import escape
import json,hashlib,textwrap

workflow_specs=json.loads((APP/'scripts/workflow-snippets.json').read_text(encoding='utf-8'))
assert len(workflow_specs)==len(arrows), 'Every UML step needs a source excerpt.'
workflow_steps=[]
for number,item in enumerate(workflow_specs,1):
    source=(APP/item['source']).read_text(encoding='utf-8')
    begin=source.index(item['start'])
    if 'end' in item:finish=source.index(item['end'],begin+len(item['start']))
    else:
        selected=source[begin:].splitlines(keepends=True)[:item.get('lines',1)]
        finish=begin+len(''.join(selected))
    code=textwrap.dedent(source[begin:finish]).strip()
    assert code,'Empty workflow excerpt'
    workflow_steps.append(dict(number=number,source=item['source'],
        firstLine=source.count('\n',0,begin)+1,
        lastLine=source.count('\n',0,finish-1)+1,
        code=code,explanation=item['explanation'],language='typescript',
        sourceSHA256=hashlib.sha256(source.encode('utf-8')).hexdigest()))

def workflow_card(number,label,description):
    step=workflow_steps[number-1]
    ref=f"{step['source']} · lines {step['firstLine']}–{step['lastLine']}"
    return (f'<section class="step workflow-step" id="workflow-step-{number:02}" data-step="{number}">'
        f'<span class="number">{number:02}</span><h3>{escape(label)}</h3><p>{escape(description)}</p>'
        f'<p class="source">Source: {escape(ref)}</p><p class="meta">Selected source excerpt; surrounding context may be omitted.</p>'
        f'<pre><code class="language-typescript">{escape(step["code"])}</code></pre>'
        f'<h4>How this code explains step {number}</h4><p>{escape(step["explanation"])}</p></section>')

(APP/'scripts/architecture-data.json').write_text(json.dumps(dict(lanes=lanes,arrows=arrows,steps=workflow_steps),indent=2),encoding='utf-8')
style=PUBLIC/'style.css'
style.write_text(style.read_text(encoding='utf-8')+'\n.workflow-step pre code[class*="language-"]{white-space:pre-wrap!important;overflow-wrap:anywhere!important;font-size:20px!important}.workflow-step .source{overflow-wrap:anywhere}\n',encoding='utf-8')
