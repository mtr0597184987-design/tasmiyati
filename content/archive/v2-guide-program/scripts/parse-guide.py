# يستخرج نصوص الدليل الجديد كما هي إلى بنية JSON: الحصص، والمهمات، والأنشطة، والجداول، والإجراءات، والنشاط البيتي.
import sys, json, re
import docx
from docx.table import Table

d = docx.Document(sys.argv[1])
blocks = []
for el in d.element.body.iterchildren():
    tag = el.tag.split('}')[1]
    if tag == 'p':
        t = ''.join(x.text or '' for x in el.iter() if x.tag.endswith('}t')).strip()
        if t:
            blocks.append(('p', t))
    elif tag == 'tbl':
        tb = Table(el, d)
        rows = []
        for r in tb.rows:
            cells = []
            prev = None
            for c in r.cells:
                if prev is not None and c._tc is prev:
                    continue
                prev = c._tc
                cells.append('\n'.join(p.text.strip() for p in c.paragraphs if p.text.strip()))
            rows.append(cells)
        blocks.append(('t', rows))

ORD = {'الأولى': 1, 'الثانية': 2, 'الثالثة': 3, 'الرابعة': 4, 'الخامسة': 5, 'السادسة': 6, 'السابعة': 7, 'الثامنة': 8, 'التاسعة': 9}
lessons = []
L = None; T = None; A = None; mode = None; H = None
i = 0
for kind, v in blocks:
    if kind == 'p':
        m = re.match(r'^الحصة (\S+): (.+)$', v)
        if m and m.group(1) in ORD:
            L = {'number': ORD[m.group(1)], 'title': m.group(2).strip(), 'header': {}, 'overview': '', 'objectives': [], 'objectivesIntro': '', 'tasks': [], 'homework': None}
            lessons.append(L); T = A = H = None; mode = 'pre'; continue
        if L is None: continue
        if v.startswith('الدرس ') and ':' in v and mode != 'pre' and len(v) < 60 and not v.startswith('الدرس المقرر'):
            continue  # ترويسة الدرس التالي
        if v.startswith('البرنامج التعليمي القائم'): L['program'] = v; continue
        if v == 'أولًا: فكرة عامة عن الدرس': mode = 'overview'; continue
        if v == 'ثانيًا: الأهداف التعليمية': mode = 'objectives'; continue
        if v.startswith('ثالثًا:'): mode = 'tasks'; continue
        if v.startswith('رابعًا: النشاط البيتي'):
            mode = 'homework'; H = {'title': '', 'tasks': [], 'followup': []}; L['homework'] = H; T = A = None; continue
        if mode == 'overview': L['overview'] += (('\n' if L['overview'] else '') + v); continue
        if mode == 'objectives':
            mm = re.match(r'^(\d+)\.\s*(.+)$', v)
            if v.startswith('يتوقع'): L['objectivesIntro'] = v
            else: L['objectives'].append(mm.group(2) if mm else v)
            continue
        if mode == 'tasks':
            if re.match(r'^المرحلة (\S+): ', v):
                stage_name = v.split(': ', 1)[1]; cur_stage = ORD[v.split()[1].rstrip(':')]; continue
            mm = re.match(r'^المهمة \((\d+)-(\d+)\): (.+?) — (\d+) دقائق?ة?$', v) or re.match(r'^المهمة \((\d+)-(\d+)\): (.+?) — (\d+) (?:دقيقة|دقائق)$', v)
            if mm:
                T = {'id': f'{mm.group(1)}-{mm.group(2)}', 'stage': cur_stage, 'stageName': stage_name, 'title': mm.group(3).strip(), 'minutes': int(mm.group(4)), 'acts': [], 'teacher': [], 'student': []}
                L['tasks'].append(T); A = None; sub = 'acts'; continue
            mm = re.match(r'^نشاط \((\d+)\): (.+)$', v)
            if mm and T is not None:
                A = {'n': int(mm.group(1)), 'title': mm.group(2).strip(), 'parts': []}; T['acts'].append(A); sub = 'acts'; continue
            if v.startswith('إجراءات التنفيذ المرتبطة بالمعلمة'): sub = 'teacher'; continue
            if v.startswith('إجراءات التنفيذ المرتبطة بالطالبة'): sub = 'student'; continue
            if T is None: raise SystemExit('unexpected: ' + v)
            if sub in ('teacher', 'student'):
                T[sub].append(re.sub(r'^[-–•]\s*', '', v)); continue
            A['parts'].append({'p': v}); continue
        if mode == 'homework':
            if v.startswith('عنوان النشاط:'): H['title'] = v.split(':', 1)[1].strip(); continue
            mm = re.match(r'^المهمة البيتية (\S+): (.+)$', v)
            if mm: A = {'n': len(H['tasks']) + 1, 'title': mm.group(2).strip(), 'parts': []}; H['tasks'].append(A); sub = 'acts'; continue
            if v.startswith('متابعة المعلمة'): sub = 'followup'; continue
            if sub == 'followup': H['followup'].append(re.sub(r'^[-–•]\s*', '', v)); continue
            A['parts'].append({'p': v}); continue
        raise SystemExit(f'unhandled ({mode}): {v[:80]}')
    else:
        if L is None: continue
        if mode == 'pre':
            for r in v[1:]:
                if len(r) >= 2: L['header'][r[0]] = r[1]
                elif len(r) == 1: L['header'][r[0]] = ''
            mode = 'afterHeader'; continue
        if A is None: raise SystemExit('table outside activity in lesson %s' % L['number'])
        A['parts'].append({'t': v})

json.dump(lessons, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False, indent=1)
for l in lessons:
    print(l['number'], l['title'], '| tasks', [t['id'] + ':' + str(len(t['acts'])) for t in l['tasks']], '| hw', len(l['homework']['tasks']) if l['homework'] else None, '| obj', len(l['objectives']), list(l['header'].keys()))
