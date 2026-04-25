#!/usr/bin/env python3
"""Deep correctness validator for generated STAAR question banks.

Loads every grade-*-curriculum.json, parses each gen-* question by category,
and verifies that the stored `answer` is mathematically correct given the
prompt text. Prints a per-grade summary and dumps up to 20 failing samples
per category so we can pinpoint generator bugs.
"""
import json, os, re, sys, glob
from fractions import Fraction
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

NUMBER_WORDS = {
    'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,
    'eight':8,'nine':9,'ten':10,'eleven':11,'twelve':12,'thirteen':13,
    'fourteen':14,'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,
    'nineteen':19,'twenty':20
}

SHAPE_SIDES = {
    'circle':0,'triangle':3,'square':4,'rectangle':4,
    'pentagon':5,'hexagon':6,'heptagon':7,'octagon':8
}

COIN_VAL = {'penny':1,'nickel':5,'dime':10,'quarter':25,
            'pennies':1,'nickels':5,'dimes':10,'quarters':25}

failures = defaultdict(list)
counts = defaultdict(lambda: [0,0])  # [pass, fail]

def fail(cat, q, reason):
    counts[cat][1] += 1
    if len(failures[cat]) < 20:
        failures[cat].append({'reason':reason,'prompt':q['prompt'][:180],'answer':q.get('answer'),'id':q.get('id','?')})

def ok(cat):
    counts[cat][0] += 1

def parse_int(s):
    return int(s.replace(',','').replace(' ',''))

def parse_num(s):
    s = s.replace(',','').replace(' ','')
    return float(s) if '.' in s else int(s)

# -------- Validators by recognized prompt pattern --------

def check_arith(q, op_map):
    p = q['prompt']
    # Match "<a> <op> <b> = ?" with optional commas/spaces in numbers
    m = re.match(r'^([\d.,\s]+)\s*([+\-−×*x/÷])\s*([\d.,\s]+)\s*=\s*\?\s*$', p)
    if not m: return None
    a = parse_num(m.group(1)); op = m.group(2); b = parse_num(m.group(3))
    if op in '+': v = a+b
    elif op in '-−': v = a-b
    elif op in '×*x': v = a*b
    elif op in '/÷': v = a/b
    else: return None
    try:
        ans = parse_num(str(q['answer']))
    except Exception:
        return False
    return abs(v - ans) < 1e-6

def check_word_arith(q):
    """Parse word-problem patterns we know the generator emits."""
    p = q['prompt']
    nums = [int(x.replace(',','')) for x in re.findall(r'\b\d[\d,]*\b', p)]
    try:
        ans = parse_num(str(q['answer']))
    except Exception:
        return None
    # Patterns are too varied to fully parse; do consistency checks where possible.
    # Each generator template uses 2 numbers and a single op. If exactly 2 numbers,
    # the answer must equal one of: a+b, a-b, b-a, a*b, a/b, b/a (when divisible).
    if len(nums) == 2:
        a,b = nums
        cands = {a+b, abs(a-b), a*b}
        if b and a%b==0: cands.add(a//b)
        if a and b%a==0: cands.add(b//a)
        return ans in cands
    if len(nums) == 3:
        a,b,c = nums
        cands = set()
        for x,y in [(a,b),(b,c),(a,c)]:
            cands |= {x+y, abs(x-y), x*y}
            if y and x%y==0: cands.add(x//y)
        cands |= {a+b+c, a*b*c, a*b+c, a+b*c, a*(b+c), (a+b)*c}
        return ans in cands
    return None  # unknown; skip

def check_q(q):
    p = q['prompt']
    ans = q.get('answer')

    # 1. pure arithmetic
    r = check_arith(q, None)
    if r is not None:
        return ('arith', r)

    # 2. "What is X + Y?" / "What is X − Y?" / etc.
    m = re.match(r'^What is\s+([\d.,\s]+)\s*([+\-−×*x/÷])\s*([\d.,\s]+)\s*\??\s*$', p)
    if m:
        a = parse_num(m.group(1)); op = m.group(2); b = parse_num(m.group(3))
        if op in '/÷' and b == 0:
            return ('what-is', None)
        v = {'+':a+b,'-':a-b,'−':a-b,'×':a*b,'*':a*b,'x':a*b,'/':a/b if b else 0,'÷':a/b if b else 0}[op]
        try: a2 = parse_num(str(ans))
        except: return ('what-is', False)
        return ('what-is', abs(v-a2) < 1e-6)

    # 3. "Round X to the nearest <place>."  Note: order longest names first to avoid "ten thousand" being captured as just "ten".
    PLACE_RE = r'(hundred thousand|ten thousand|thousand|hundred|ten|hundredth|tenth)'
    m = re.match(r'^(?:Round|What is|Estimate)\s+([\d.,]+)\s+(?:rounded\s+)?(?:to(?:\s+the)?\s+(?:nearest|the))\s+'+PLACE_RE+r's?\b', p, re.I)
    if not m:
        m = re.match(r'^([\d.,]+)\s+rounded to the '+PLACE_RE+r's? place is what\?', p, re.I)
    if m:
        n_str = m.group(1).replace(',','')
        place = m.group(2).lower()
        # Use integer/decimal arithmetic to avoid FP divergence with JS's Math.round.
        if place in ('tenth','hundredth'):
            # Convert to integer in milli-units (×1000)
            if '.' in n_str:
                whole, frac = n_str.split('.')
                frac = (frac + '000')[:3]
                centi = int(whole)*1000 + int(frac)
            else:
                centi = int(n_str)*1000
            div = 100 if place=='tenth' else 10  # round to nearest 0.1 or 0.01
            # JS Math.round: half-up toward +inf
            q, r = divmod(centi, div)
            if r*2 >= div: q += 1
            rounded_milli = q*div
            rounded = rounded_milli / 1000.0
            try: a2 = float(str(ans).replace(',',''))
            except: return ('round', False)
            return ('round', abs(rounded - a2) < 1e-9)
        factor = {'ten':10,'hundred':100,'thousand':1000,'ten thousand':10000,'hundred thousand':100000}[place]
        n_int = int(n_str)
        q, r = divmod(n_int, factor)
        if r*2 >= factor: q += 1
        rounded = q * factor
        try: a2 = int(str(ans).replace(',',''))
        except: return ('round', False)
        return ('round', a2 == rounded)

    # 4. Place value: "What is the value of the digit D in N?"
    m = re.search(r'(?:value of the digit|the digit) (\d) (?:in|of)\s*(?:the number\s+)?([\d,]+)', p)
    if not m:
        m = re.search(r'In\s+([\d,]+),\s+what does the (?:digit\s+)?(\d) represent', p)
        if m:
            number = m.group(1); digit = m.group(2)
        else:
            number = digit = None
    else:
        digit = m.group(1); number = m.group(2)
    if not digit and 'place value' in p.lower():
        digit = number = None
    if digit:
        n = number.replace(',','')
        place_val = None
        # Find the digit in n; rightmost? leftmost? generator's `value` is digit*place where digit is unique to that place
        for i, ch in enumerate(reversed(n)):
            if ch == digit:
                place_val = int(digit) * (10**i)
                break
        try: a2 = int(str(ans).replace(',',''))
        except: return ('place-value', False)
        # Multiple matches possible (digit appears twice). Accept if answer matches any occurrence's place value.
        cands = []
        for i, ch in enumerate(reversed(n)):
            if ch == digit:
                cands.append(int(digit) * (10**i))
        return ('place-value', a2 in cands)

    # 5. Compare symbol "X ___ Y" answer in {<,>,=}
    m = re.search(r'([\d.,/]+)\s*___\s*([\d.,/]+)', p)
    if m and ans in ('<','>','='):
        a = m.group(1).rstrip('.,;:!?'); b = m.group(2).rstrip('.,;:!?')
        try:
            if '/' in a and '/' in b and re.match(r'^\d+/\d+$', a) and re.match(r'^\d+/\d+$', b):
                an,ad = map(int,a.split('/')); bn,bd = map(int,b.split('/'))
                af = Fraction(an,ad); bf = Fraction(bn,bd)
            else:
                af = float(a.replace(',','')); bf = float(b.replace(',',''))
        except Exception:
            return None
        true = '<' if af<bf else '>' if af>bf else '='
        return ('compare', true == ans)

    # 6. Decimal place lookup: "digit in the <name> place of N.N"
    m = re.search(r'(?:digit (?:in|of)\s+the\s+)(tenths|hundredths|thousandths)\s+(?:place|digit)\s+(?:of\s+)?([\d.]+)', p)
    if not m:
        m = re.search(r'([\d.]+)\s+[—-]\s*find the digit in the (tenths|hundredths|thousandths)', p)
        if m:
            decstr = m.group(1); place = m.group(2)
        else:
            decstr = place = None
    else:
        place = m.group(1); decstr = m.group(2)
    if not place:
        m = re.search(r'In\s+([\d.]+),\s+which digit is in the (tenths|hundredths|thousandths)', p)
        if m: decstr=m.group(1); place=m.group(2)
    if not place:
        m = re.search(r'Identify the (tenths|hundredths|thousandths) digit of ([\d.]+)', p)
        if m: place=m.group(1); decstr=m.group(2)
    if place and decstr and '.' in decstr:
        frac = decstr.split('.')[1]
        idx = {'tenths':0,'hundredths':1,'thousandths':2}[place]
        if idx < len(frac):
            true = int(frac[idx])
            try: a2 = int(str(ans))
            except: return ('dec-place', False)
            return ('dec-place', a2 == true)

    # 7. Number names: "Which word matches the number N?" / "Which number matches the word "W"?"
    m = re.search(r'word matches the number\s+(\d+)\?', p)
    if m:
        n = int(m.group(1)); want = list(NUMBER_WORDS.keys())[list(NUMBER_WORDS.values()).index(n)]
        return ('num-name', ans == want)
    m = re.search(r'number matches the word\s+"(\w+)"', p)
    if m:
        w = m.group(1).lower()
        if w in NUMBER_WORDS:
            try: a2 = int(str(ans))
            except: return ('num-name', False)
            return ('num-name', a2 == NUMBER_WORDS[w])

    # 8. One more / one less (Kindergarten phrasing). Don't capture generic "N more/less".
    m = re.search(r'\b(?:one|1)\s+(more|less)\s+than\s+(\d+)', p, re.I)
    if m:
        d = m.group(1).lower(); n = int(m.group(2))
        true = n+1 if d=='more' else n-1
        try: a2 = int(str(ans))
        except: return ('one-mlt', False)
        return ('one-mlt', a2 == true)

    # 9. Comes next/before/between
    m = re.search(r'just before\s+(\d+)', p)
    if m:
        n = int(m.group(1))
        try: a2 = int(str(ans))
        except: return ('seq', False)
        return ('seq', a2 == n-1)
    m = re.search(r'between\s+(\d+)\s+and\s+(\d+)', p)
    if m:
        a,b = int(m.group(1)), int(m.group(2))
        if abs(a-b)==2:
            try: a2 = int(str(ans))
            except: return ('seq', False)
            return ('seq', a2 == (a+b)//2)
    m = re.search(r'^What number comes next:\s+(\d+),\s*(\d+),\s*(\d+),\s*___\?', p)
    if m:
        nums = [int(m.group(i)) for i in (1,2,3)]
        step = nums[1]-nums[0]
        try: a2 = int(str(ans))
        except: return ('seq', False)
        return ('seq', a2 == nums[2]+step)

    # 10. Skip count
    m = re.search(r'Skip count by (\d+)s:\s+([\d, ]+),\s*___\?', p)
    if m:
        step = int(m.group(1))
        seq = [int(x) for x in m.group(2).split(',')]
        try: a2 = int(str(ans).replace(',',''))
        except: return ('skip', False)
        return ('skip', a2 == seq[-1]+step)

    # 11. Tens & ones in N
    m = re.search(r'In\s+(\d+),\s+how many\s+(tens|ones)', p)
    if m:
        n = int(m.group(1)); ask = m.group(2)
        true = (n//10) if ask=='tens' else (n%10)
        try: a2 = int(str(ans))
        except: return ('tens-ones', False)
        return ('tens-ones', a2 == true)
    m = re.search(r'digit in the\s+(tens|ones)\s+place of\s+(\d+)', p)
    if m:
        ask = m.group(1); n = int(m.group(2))
        true = (n//10)%10 if ask=='tens' else n%10
        try: a2 = int(str(ans))
        except: return ('tens-ones', False)
        return ('tens-ones', a2 == true)

    # 12. Rectangle perimeter / area
    m = re.search(r'(\d+)\s*(cm|m|in|ft|yd|units)?\s*(?:long\s+and|by|×)\s*(\d+)\s*(cm|m|in|ft|yd|units)?', p)
    if m and ('perimeter' in p.lower() or 'area' in p.lower() or 'volume' in p.lower()):
        l = int(m.group(1)); w = int(m.group(3))
        # Try to find a third number for volume
        m3 = re.findall(r'\b(\d+)\b', p)
        try:
            a2 = int(str(ans).split()[0].replace(',',''))
        except:
            return ('geom', False)
        cands = {2*(l+w), l*w}
        if 'volume' in p.lower() and len(m3) >= 3:
            try:
                h = int(m3[2])
                cands.add(l*w*h)
            except: pass
        return ('geom', a2 in cands)

    # 13. Counting visible item rows (emoji)
    # Detect repeated single-char emoji block; count is len/char_count_per_grapheme
    m = re.search(r'How many\b', p)
    if m and re.search(r'([\U0001F300-\U0001FAFF\u2600-\u27BF])\1*', p):
        # count the longest repeated emoji
        import unicodedata
        # Find all runs of identical chars (any non-ASCII non-space)
        best = 0
        run_char = None; run = 0
        for ch in p:
            if ord(ch) > 127 and ch not in (' ','\n'):
                if ch == run_char: run += 1
                else: run_char = ch; run = 1
                if run > best: best = run
            else:
                run_char = None; run = 0
        if best > 0:
            try: a2 = int(str(ans))
            except:
                # word answer?
                if str(ans).lower() in NUMBER_WORDS:
                    return ('count', NUMBER_WORDS[str(ans).lower()] == best)
                return ('count', False)
            return ('count', a2 == best)

    # 14. Shape sides
    m = re.search(r'How many sides does a (\w+) have', p)
    if not m: m = re.search(r'A (\w+) has how many sides', p)
    if not m: m = re.search(r'Count the sides of a (\w+)', p)
    if m:
        sh = m.group(1).lower()
        if sh in SHAPE_SIDES:
            try: a2 = int(str(ans))
            except:
                if str(ans).lower() in NUMBER_WORDS:
                    return ('shape-sides', NUMBER_WORDS[str(ans).lower()] == SHAPE_SIDES[sh])
                return ('shape-sides', False)
            return ('shape-sides', a2 == SHAPE_SIDES[sh])
    m = re.search(r'How many (sides|vertices) does a (\w+) have', p)
    if not m: m = re.search(r'A (\w+) has how many (sides|vertices)', p)
    if m:
        # patterns differ in group order; re-detect
        a_,b_ = m.group(1), m.group(2)
        ask = a_ if a_ in ('sides','vertices') else b_
        sh = b_ if a_ in ('sides','vertices') else a_
        if sh.lower() in SHAPE_SIDES:
            try: a2 = int(str(ans))
            except: return ('shape-sides', False)
            return ('shape-sides', a2 == SHAPE_SIDES[sh.lower()])

    # 15. Coin identification
    m = re.search(r'coin (?:is worth|worth)\s+(\d+)\s*(?:cent|cents|¢)', p)
    if not m: m = re.search(r'(\d+)-cent coin is called', p)
    if not m: m = re.search(r'name of the coin worth\s+(\d+)¢', p)
    if m:
        v = int(m.group(1))
        true = {1:'penny',5:'nickel',10:'dime',25:'quarter'}.get(v)
        return ('coin-id', ans == true)

    # 16. Coin total
    if 'total value' in p.lower() or 'how many cents' in p.lower() or p.lower().startswith('find the total'):
        # parse "<n> <coin>(s)"
        total = 0
        for m in re.finditer(r'(\d+)\s+(pennies|nickels|dimes|quarters|penny|nickel|dime|quarter)', p):
            total += int(m.group(1)) * COIN_VAL[m.group(2)]
        if total > 0:
            try:
                a_str = str(ans).replace('¢','').replace(' cents','').replace(',','').strip()
                a2 = int(a_str)
            except: return ('coin-total', False)
            return ('coin-total', a2 == total)

    # 17. Time-of-day strings: "X minutes after H o'clock" or "half past H"
    m = re.search(r"(\d+)\s+minutes after\s+(\d+)", p)
    if m:
        mm = int(m.group(1)); hh = int(m.group(2))
        true = f"{hh}:{mm:02d}"
        return ('time', str(ans).strip() == true)
    m = re.search(r"half past\s+(\d+)", p)
    if m:
        hh = int(m.group(1))
        return ('time', str(ans).strip() == f"{hh}:30")
    m = re.search(r"(\d+)\s+o'clock", p)
    if m and 'lasts' not in p and 'ran' not in p and 'began' not in p and 'after' not in p:
        hh = int(m.group(1))
        return ('time', str(ans).strip() == f"{hh}:00")

    # 18. Elapsed time: "starts at H:MM and lasts X minutes"
    m = re.search(r"(?:starts? at|began at|Start:)\s+(\d+):(\d+)\D+(\d+)\s+minutes", p)
    if m:
        h = int(m.group(1)); mn = int(m.group(2)); add = int(m.group(3))
        total = h*60+mn+add
        eh = total//60; em = total%60
        if eh > 12: eh -= 12
        true = f"{eh}:{em:02d}"
        return ('elapsed', str(ans).strip() == true)

    # 19. Length comparison: "How much longer is the longer one?"
    if 'longer' in p.lower() and ('paper clip' in p or 'cubes' in p or 'pencil' in p or 'crayon' in p):
        nums = [int(x) for x in re.findall(r'\b\d+\b', p)]
        if len(nums) >= 2:
            a,b = nums[0], nums[1]
            try:
                a2 = int(str(ans).split()[0])
            except: return ('measure', False)
            return ('measure', a2 == abs(a-b))

    # 20. Conversion: "Convert: N <from> = ? <to>"
    m = re.search(r'Convert:\s+(\d+)\s+(\w+)\s+=\s+\?\s+(\w+)', p)
    if not m: m = re.search(r'How many\s+(\w+)\s+are in\s+(\d+)\s+(\w+)', p)
    if not m: m = re.search(r'(\d+)\s+(\w+)\s+equals how many\s+(\w+)', p)
    if not m: m = re.search(r'Change\s+(\d+)\s+(\w+)\s+to\s+(\w+)', p)
    if m:
        groups = m.groups()
        # rearrange to (n, src, dst)
        if 'are in' in p:
            dst, n, src = groups
        else:
            n, src, dst = groups
        n = int(n)
        FACT = {('feet','inches'):12,('yards','feet'):3,('yards','inches'):36,
                ('miles','feet'):5280,('pounds','ounces'):16,('tons','pounds'):2000,
                ('gallons','quarts'):4,('gallons','pints'):8,('gallons','cups'):16,
                ('quarts','pints'):2,('quarts','cups'):4,('pints','cups'):2,
                ('m','cm'):100,('m','mm'):1000,('cm','mm'):10,('km','m'):1000,
                ('km','cm'):100000,('kg','g'):1000,('g','mg'):1000,
                ('L','mL'):1000,('kL','L'):1000}
        f = FACT.get((src,dst))
        if f:
            try: a2 = int(str(ans).split()[0].replace(',',''))
            except: return ('convert', False)
            return ('convert', a2 == n*f)

    # 21. Fact family / unknown variants: "find missing"
    m = re.search(r'^(\d+)\s*\+\s*\?\s*=\s*(\d+)', p)
    if m:
        a = int(m.group(1)); t = int(m.group(2))
        try: a2 = int(str(ans))
        except: return ('unknown', False)
        return ('unknown', a2 == t-a)
    m = re.search(r'^\?\s*\+\s*(\d+)\s*=\s*(\d+)', p)
    if m:
        a = int(m.group(1)); t = int(m.group(2))
        try: a2 = int(str(ans))
        except: return ('unknown', False)
        return ('unknown', a2 == t-a)
    m = re.search(r'^(\d+)\s*[-−]\s*\?\s*=\s*(\d+)', p)
    if m:
        a = int(m.group(1)); t = int(m.group(2))
        try: a2 = int(str(ans))
        except: return ('unknown', False)
        return ('unknown', a2 == a-t)
    m = re.search(r'(\d+)\s+take away what number gives\s+(\d+)', p)
    if m:
        a = int(m.group(1)); t = int(m.group(2))
        try: a2 = int(str(ans))
        except: return ('unknown', False)
        return ('unknown', a2 == a-t)

    # 22. Equivalent fractions (MC): we just trust generator - skip
    # 23. Like-fractions add/sub MC
    m = re.match(r'^(\d+)/(\d+)\s*([+\-−])\s*(\d+)/(\2)\s*=\s*\?\s*$', p)
    if m:
        a=int(m.group(1)); d=int(m.group(2)); op=m.group(3); b=int(m.group(4))
        v = a+b if op=='+' else a-b
        return ('frac-like', str(ans).strip() == f"{v}/{d}")

    return None

def main():
    files = sorted(glob.glob(os.path.join(DATA, 'grade-*-curriculum.json')))
    grand_pass = 0; grand_fail = 0; grand_skip = 0
    for f in files:
        d = json.load(open(f))
        for u in d['units']:
            for l in u['lessons']:
                for q in l['questions']:
                    if not q.get('id','').startswith('gen-'): continue
                    # MC integrity: answer must appear in choices
                    if q.get('type') == 'multiple_choice':
                        if str(q['answer']) not in [str(c) for c in q.get('choices',[])]:
                            counts['mc-integrity'][1] += 1
                            grand_fail += 1
                            if len(failures['mc-integrity']) < 20:
                                failures['mc-integrity'].append({'id':q.get('id'),'prompt':q['prompt'][:180],'answer':q.get('answer'),'reason':f'answer not in choices {q.get("choices")}'})
                            continue
                        # Also check no duplicate choices
                        chs = [str(c) for c in q.get('choices',[])]
                        if len(set(chs)) != len(chs):
                            counts['mc-integrity'][1] += 1
                            grand_fail += 1
                            if len(failures['mc-integrity']) < 20:
                                failures['mc-integrity'].append({'id':q.get('id'),'prompt':q['prompt'][:180],'answer':q.get('answer'),'reason':f'duplicate choices {chs}'})
                            continue
                        counts['mc-integrity'][0] += 1
                    res = check_q(q)
                    if res is None:
                        counts['_skip'][0] += 1
                        grand_skip += 1
                        continue
                    cat, passed = res
                    if passed is None:
                        counts['_skip'][0] += 1
                        grand_skip += 1
                        continue
                    if passed:
                        ok(cat); grand_pass += 1
                    else:
                        fail(cat, q, 'wrong'); grand_fail += 1
        print(f"  scanned {os.path.basename(f)}")

    print()
    print("="*70)
    print(f"PASS={grand_pass}  FAIL={grand_fail}  unparsed/skip={grand_skip}")
    print("="*70)
    for cat,(p,f_) in sorted(counts.items()):
        if cat == '_skip': continue
        rate = (f_/(p+f_)*100) if (p+f_)>0 else 0
        marker = ' ❌' if f_ else ''
        print(f"  {cat:18}  pass={p:6d}  fail={f_:5d}  ({rate:5.2f}%){marker}")
    print()
    for cat, samples in failures.items():
        print(f"--- failures in {cat} (showing up to 5) ---")
        for s in samples[:5]:
            print(f"  [{s['id']}] answer={s['answer']!r}")
            print(f"    prompt: {s['prompt']}")
    return 0 if grand_fail == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
