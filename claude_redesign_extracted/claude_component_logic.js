
class Component extends DCLogic {
  componentWillUnmount() { clearTimeout(this._t); }
  v(k, d) {
    const s = (this.state || {})[k];
    if (s !== undefined) return s;
    const p = this.props[k];
    return (p === undefined || p === null || p === '') ? d : p;
  }
  on(k, d) { const x = this.v(k, d); return x === true || x === 'true' || x === 'on'; }
  renderVals() {
    const put = (o) => () => this.setState(o);
    const F = {
      mono: '"ABC ROM Mono", ui-monospace, Menlo, monospace',
      sans: '"ABC Arizona Sans", system-ui, sans-serif',
      serif: '"Charis SIL", Charter, Georgia, serif',
      flare: '"ABC Arizona Flare", Georgia, serif'
    };
    const base = {
      'r-card': '12px', 'r-ctl': '100px', 'r-sheet': '20px', 'r-seg': '100px', 'r-row': '12px', 'r-search': '100px',
      'note-r': '12px', 'chip-r': '100px', 'chip-bg': 'transparent',
      'font-ui': F.sans, 'font-display': F.flare, 'font-meta': F.mono, 'font-badge': F.flare,
      'display-w': '400', 'display-track': '-0.035em', 'dot-glow': 'none', 'note-tag': 'var(--ink-3)'
    };
    const TH = {
      solos: { write: 'mono', vars: Object.assign({}, base, {
        bg: '#FFFFFF', panel: '#F7F7F7', card: '#FFFFFF', input: '#FFFFFF', pill: '#F2F2F2', cork: '#F7F7F7',
        line: '#DCD5C9', 'line-soft': 'rgba(0,0,0,0.07)',
        ink: '#1A1A1A', 'ink-max': '#000000', 'ink-2': '#535353', 'ink-3': '#6B6B6B', sib: '#535353', dim: '#8A8A8A',
        hover: 'rgba(0,0,0,0.05)', press: 'rgba(0,0,0,0.08)',
        'seg-bg': 'rgba(0,0,0,0.06)', 'seg-on': '#FFFFFF', 'seg-sh': '0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.12)',
        'btn-bg': '#1A1A1A', 'btn-ink': '#FFFFFF', dot: '#1A1A1A', caret: '#000000', sel: 'rgba(0,0,0,0.09)',
        scrim: 'rgba(0,0,0,0.22)', ring: '0 0 0 1px rgba(0,0,0,0.08)',
        shadow: '0 0 0 1px rgba(0,0,0,0.08), 0 2px 5px rgba(0,0,0,0.14)',
        'shadow-lg': '0 0 0 1px rgba(0,0,0,0.08), 0 23px 51px rgba(0,0,0,0.20)',
        'note-bg': '#FFFFFF', 'note-bd': '1px solid rgba(0,0,0,0.08)',
        'badge-bg': '#EDEDED', 'badge-ink': '#1A1A1A', 'chip-bd': '1px solid rgba(0,0,0,0.14)'
      }) },
      night: { write: 'mono', vars: Object.assign({}, base, {
        bg: '#000000', panel: '#121212', card: '#1F1F1F', input: '#292929', pill: '#1F1F1F', cork: '#000000',
        line: '#3D3D3D', 'line-soft': '#1F1F1F',
        ink: '#EBEBEB', 'ink-max': '#FFFFFF', 'ink-2': '#B8B8B8', 'ink-3': '#8F8F8F', sib: '#888888', dim: '#555555',
        hover: 'rgba(255,255,255,0.06)', press: 'rgba(255,255,255,0.12)',
        'seg-bg': '#292929', 'seg-on': '#3D3D3D', 'seg-sh': 'none',
        'btn-bg': '#EBEBEB', 'btn-ink': '#000000', dot: '#E2A93B', 'dot-glow': '0 0 8px rgba(226,169,59,0.65)',
        caret: '#E2A93B', sel: 'rgba(226,169,59,0.22)', scrim: 'rgba(0,0,0,0.62)', ring: '0 0 0 1px #3D3D3D',
        shadow: '0 0 0 1px #3D3D3D', 'shadow-lg': '0 0 0 1px #3D3D3D, 0 24px 64px rgba(0,0,0,0.7)',
        'note-bg': '#1F1F1F', 'note-bd': '1px solid #3D3D3D', 'note-tag': '#E2A93B',
        'badge-bg': '#1F1F1F', 'badge-ink': '#E2A93B', 'chip-bd': '1px solid #3D3D3D'
      }) },
      journal: { write: 'sans', vars: Object.assign({}, base, {
        bg: '#FFFFFF', panel: '#F7F8FA', card: '#FFFFFF', input: '#EDEFF2', pill: '#EDEFF2', cork: '#F7F8FA',
        line: '#E1E4E9', 'line-soft': 'rgba(0,0,0,0.06)',
        ink: '#1C1C1E', 'ink-max': '#000000', 'ink-2': '#50555C', 'ink-3': '#6B7078', sib: '#50555C', dim: '#9DA2A8',
        hover: 'rgba(36,104,200,0.06)', press: 'rgba(36,104,200,0.10)',
        'seg-bg': '#E9EBEF', 'seg-on': '#FFFFFF', 'seg-sh': '0 1px 3px rgba(0,0,0,0.14)',
        'btn-bg': '#2468C8', 'btn-ink': '#FFFFFF', dot: '#2468C8', caret: '#2468C8', sel: 'rgba(36,104,200,0.14)',
        scrim: 'rgba(20,24,30,0.25)', ring: '0 0 0 1px rgba(0,0,0,0.06)',
        shadow: '0 0 0 1px rgba(0,0,0,0.04), 0 2px 10px rgba(0,0,0,0.07)',
        'shadow-lg': '0 0 0 1px rgba(0,0,0,0.05), 0 24px 60px rgba(0,0,0,0.18)',
        'r-card': '14px', 'r-ctl': '10px', 'r-sheet': '16px', 'r-seg': '9px', 'r-row': '10px', 'note-r': '14px',
        'note-bg': '#FFFFFF', 'note-bd': '1px solid rgba(0,0,0,0.05)', 'note-tag': '#2468C8',
        'badge-bg': '#2468C8', 'badge-ink': '#FFFFFF', 'chip-bd': '1px solid transparent', 'chip-bg': '#EDEFF2',
        'font-display': F.sans, 'font-badge': F.sans, 'display-w': '650', 'display-track': '-0.02em'
      }) },
      manuscript: { write: 'serif', vars: Object.assign({}, base, {
        bg: '#FAF8F5', panel: '#EAE6DF', card: '#FFFDF9', input: '#FFFDF9', pill: '#EAE6DF', cork: '#E6E1D8',
        line: '#D3CCC0', 'line-soft': 'rgba(60,45,30,0.09)',
        ink: '#26221E', 'ink-max': '#000000', 'ink-2': '#58514A', 'ink-3': '#6E665C', sib: '#58514A', dim: '#A39A8E',
        hover: 'rgba(60,45,30,0.06)', press: 'rgba(60,45,30,0.10)',
        'seg-bg': '#E0DBD2', 'seg-on': '#FFFDF9', 'seg-sh': '0 0 0 1px #D3CCC0',
        'btn-bg': '#3B342C', 'btn-ink': '#FAF8F5', dot: '#3B342C', caret: '#26221E', sel: 'rgba(110,90,62,0.16)',
        scrim: 'rgba(40,30,20,0.25)', ring: '0 0 0 1px #D3CCC0',
        shadow: '0 0 0 1px #D3CCC0, 0 1px 2px rgba(60,45,30,0.08)',
        'shadow-lg': '0 0 0 1px #D3CCC0, 0 20px 48px rgba(60,45,30,0.18)',
        'r-card': '4px', 'r-ctl': '6px', 'r-sheet': '8px', 'r-seg': '6px', 'r-row': '4px', 'r-search': '6px',
        'note-r': '3px', 'chip-r': '2px', 'chip-bg': 'transparent',
        'note-bg': '#FFFDF9', 'note-bd': '1.5px dashed #C8C2B8',
        'badge-bg': '#FFFDF9', 'badge-ink': '#26221E', 'chip-bd': '1px solid #B9B1A5',
        'font-display': F.serif, 'font-badge': F.serif, 'display-w': '700', 'display-track': '-0.01em'
      }) },
      hc: { write: 'sans', vars: Object.assign({}, base, {
        bg: '#FFFFFF', panel: '#FFFFFF', card: '#FFFFFF', input: '#FFFFFF', pill: '#FFFFFF', cork: '#FFFFFF',
        line: '#000000', 'line-soft': '#000000',
        ink: '#000000', 'ink-max': '#000000', 'ink-2': '#000000', 'ink-3': '#000000', sib: '#000000', dim: '#595959',
        hover: 'rgba(0,0,0,0.12)', press: 'rgba(0,0,0,0.16)',
        'seg-bg': '#FFFFFF', 'seg-on': '#FFFFFF', 'seg-sh': '0 0 0 2px #000000',
        'btn-bg': '#000000', 'btn-ink': '#FFFFFF', dot: '#000000', caret: '#000000', sel: '#DDDDDD',
        scrim: 'rgba(0,0,0,0.55)', ring: '0 0 0 1.5px #000000',
        shadow: '0 0 0 1.5px #000000', 'shadow-lg': '0 0 0 2px #000000',
        'note-bg': '#FFFFFF', 'note-bd': '1.5px solid #000000',
        'badge-bg': '#000000', 'badge-ink': '#FFFFFF', 'chip-bd': '1.5px solid #000000',
        'display-w': '500'
      }) }
    };
    const DASH = { solos: '#9A9A9A', night: '#666666', journal: '#B8BEC7', manuscript: '#C8C2B8', hc: '#000000' };

    const tk = TH[this.v('theme', 'solos')] ? this.v('theme', 'solos') : 'solos';
    const th = TH[tk];
    const ms = tk === 'manuscript';
    const wfPick = this.v('writeFont', 'auto');
    const wf = wfPick === 'auto' ? th.write : wfPick;
    const ts = Number(this.v('textSize', tk === 'hc' ? 22 : (wf === 'mono' ? 19 : 20)));
    const cardStyle = this.v('cards', ms ? 'index' : 'plain');
    const indexCards = cardStyle === 'index';
    const lh = Number(this.v('leading', 1.7));
    const chrome = this.on('chrome', true);
    const left = this.on('left', false);
    const view = this.v('view', 'write');
    const right = this.on('right', false) && view === 'write';
    const focus = this.v('focus', 'sentence');
    const modal = this.v('modal', 'none');
    const ai = view === 'write' ? this.v('ai', 'none') : 'none';
    const sync = this.v('sync', 'synced');
    const syncedAt = this.v('syncedAt', '14:02');
    const libView = this.v('libView', tk === 'journal' ? 'journal' : 'binder');
    const critApplied = this.on('critApplied', false);

    const cardVars = indexCards
      ? ';--note-bd:1.5px dashed ' + DASH[tk] + ';--note-r:3px'
      : (ms ? ';--note-bd:1px solid #D3CCC0;--note-r:6px' : '');
    const vars = Object.entries(th.vars).map(([k, x]) => '--' + k + ':' + x).join(';') + ';--font-write:' + F[wf] + cardVars;

    // Typewriter canvas: paragraphs as sentences, sentences as parts.
    const P = [
      [[{ t: 'Snow turned detective. ' }], [{ t: 'Instead of looking upward into the sky for bad air, he walked house to house, recording who lived, who died, and where each household drew its water.' }]],
      [[{ t: 'The nexus pointed unmistakably toward the public pump at the corner of Broad Street and Cambridge Street. ' }],
        critApplied
          ? [{ t: 'The neighborhood prized its water for its cool, effervescent clarity—a clarity that concealed deadly Vibrio cholerae bacteria.' }]
          : [{ t: 'Its water ' }, { t: 'was prized', crit: true }, { t: ' throughout the neighborhood for its cool, effervescent clarity—a clarity that concealed deadly Vibrio cholerae bacteria.' }]],
      [[{ t: 'Workhouses with their own private wells had zero deaths, while distant factory workers who drank from the pump died within hours.' }]]
    ];
    const act = ai === 'continue' || ai === 'palette' ? [2, 0] : [1, 1];
    const color = (pi, si) => {
      if (focus === 'off') return 'var(--ink)';
      if (focus === 'paragraph') return pi === act[0] ? 'var(--ink)' : 'var(--dim)';
      if (pi === act[0] && si === act[1]) return 'var(--ink-max)';
      if (pi === act[0]) return 'var(--sib)';
      return 'var(--dim)';
    };
    const showCrit = chrome && ai !== 'palette';
    const seg0 = { t: '', isText: false, isCrit: false, isGhost: false, isCaret: false, color: 'var(--ink)', bg: 'transparent', tap: null };
    const caret = Object.assign({}, seg0, { isCaret: true });
    const paras = P.map((sents, pi) => {
      const segs = [];
      sents.forEach((parts, si) => {
        const c = color(pi, si);
        const bg = (ai === 'palette' && pi === 2 && si === 0) ? 'var(--sel)' : 'transparent';
        parts.forEach((pt) => {
          const isCrit = !!pt.crit && showCrit;
          segs.push(Object.assign({}, seg0, { t: pt.t, isText: !isCrit, isCrit, color: c, bg, tap: put({ ai: 'critique' }) }));
        });
        if (pi === act[0] && si === act[1] && ai !== 'palette' && ai !== 'continue') segs.push(caret);
      });
      if (ai === 'continue' && pi === 2) {
        segs.push(Object.assign({}, seg0, { isGhost: true, t: ' When Snow marked each death as a small black bar on a street map, the bars stacked highest around a single point: the pump.' }));
        segs.push(caret);
      }
      return {
        segs,
        hasNote: right && pi < 2,
        plus: right && pi === 2 && ai === 'none',
        palette: ai === 'palette' && pi === 2,
        critPop: ai === 'critique' && pi === 1 && !critApplied,
        keep: ai === 'continue' && pi === 2
      };
    });
    const shiftY = ai === 'continue' ? -150 : 0;

    const actions = [
      ['1', 'Rewrite tone', 'Warmer, plainer, sharper'],
      ['2', 'Summarize', 'In one line'],
      ['3', 'Expand thought', 'Add the next beat'],
      ['4', 'Check passive voice', ''],
      ['5', 'Fix flow', 'Smooth the handoff']
    ].map(([key, label, hint], i) => ({ key, label, hint, enter: i === 0 ? '↵' : '', bg: i === 0 ? 'var(--hover)' : 'transparent', run: put({ ai: 'none' }) }));

    const notes = [
      { label: '¶ 1', when: 'Sep 22', text: 'Steven Johnson insight: Thomas Kuhn paradigm shifts in action. The medical establishment clung to miasma theory despite overwhelming counter-evidence.', anchor: 198 + shiftY, top: 182 + shiftY },
      { label: '¶ 2', when: 'Sep 22', text: 'First famous information design: Snow’s Voronoi diagram / dot distribution map.', anchor: 348 + shiftY, top: 352 + shiftY }
    ];

    // Scrivenings + corkboard
    const intro = [
      { t: 'London in 1854 was a city of two and a half million people, the largest metropolis on the planet. Yet it was grappling with an ancient human dilemma: what to do with the waste of a civilization.' },
      { t: 'Dr. John Snow lived in Soho, just a short walk from Broad Street. Unlike his contemporaries who believed in the prevailing miasma theory—that diseases were transmitted through poisonous vapors and foul air—Snow suspected an entirely different vector.' }
    ];
    const S = [
      { title: '1. The Soho Outbreak', words: 89, status: 'Revised', paras: [
        'In late August of 1854, cholera struck the neighborhood of Soho with apocalyptic velocity. Within seventy-two hours, dozens of healthy residents collapsed with acute dehydration.',
        'The death carts rattled through the narrow streets. Families barricaded themselves inside their homes, lighting fires of pitch and vinegar in a futile effort to burn away the supposed miasma that permeated the summer air.',
        'Snow recognized that the sudden, violent onset could not be accounted for by generalized air quality. It required a discrete, shared physical contamination source.'] },
      { title: '2. The Broad Street Pump', words: 93, status: 'Draft', paras: [
        'Snow turned detective. Instead of looking upward into the sky for bad air, he walked house to house, recording who lived, who died, and where each household drew its water.',
        'The nexus pointed unmistakably toward the public pump at the corner of Broad Street and Cambridge Street. Its water was prized throughout the neighborhood for its cool, effervescent clarity—a clarity that concealed deadly Vibrio cholerae bacteria.',
        'Workhouses with their own private wells had zero deaths, while distant factory workers who drank from the pump died within hours.'] },
      { title: '3. Removing the Pump Handle', words: 61, status: 'To do', paras: [
        'On the evening of September 7, Snow presented his evidence to the Board of Guardians of St. James Parish. Skeptical but desperate, they agreed to test his radical hypothesis.',
        'The following morning, the handle of the Broad Street pump was removed. The epidemic subsided almost immediately, cementing one of the founding breakthroughs of modern epidemiology.'] }
    ];
    const stamp = (s) => ms ? '[' + s.toUpperCase() + ']' : s;
    const sections = S.map((s, i) => ({
      title: s.title, words: s.words, status: stamp(s.status),
      color: (focus === 'off' || i === 1) ? 'var(--ink)' : 'var(--sib)',
      paras: s.paras.map((t, j) => ({ t, caret: i === 1 && j === 1 }))
    }));
    const cards = S.map((s) => ({
      title: s.title, status: stamp(s.status), words: s.words,
      syn: s.paras[0], pct: Math.round(s.words / 400 * 100) + '%'
    }));

    // Library
    const pickDoc = put({ view: 'write', left: false });
    const rows = [
      { title: 'Chapter 1: The Outbreak & Broad Street', meta: '3 sections · 243 w', folder: true, indent: 0, scriv: true, active: view !== 'write', pick: put({ view: 'scrivenings', left: false }) },
      { title: '1. The Soho Outbreak', status: 'Revised', meta: '89 w', indent: 22, pick: pickDoc },
      { title: '2. The Broad Street Pump', status: 'Draft', meta: '93 w', indent: 22, active: view === 'write', pick: pickDoc },
      { title: '3. Removing the Pump Handle', status: 'To do', meta: '61 w', indent: 22, pick: pickDoc },
      { title: 'Welcome to Daylight Writer', meta: '142 w · #daylight/welcome', indent: 0, pick: pickDoc }
    ].map((r) => Object.assign({ folder: false, scriv: false, status: '' }, r, {
      isDoc: !r.folder, hasStatus: !!r.status, statusLabel: r.status ? stamp(r.status) : '',
      bg: r.active ? 'var(--card)' : 'transparent', ring: r.active ? 'var(--shadow)' : 'none', weight: r.active ? 600 : 400
    }));
    const entries = [
      { day: '22', mon: 'Sep', time: '6:30 PM', title: '2. The Broad Street Pump', snip: 'Snow turned detective. Instead of looking upward into the sky for bad air, he walked house to house…', tags: '#ghost-map  #essays/drafts', docs: true, active: true },
      { day: '22', mon: 'Sep', time: '5:12 PM', title: '1. The Soho Outbreak', snip: 'In late August of 1854, cholera struck the neighborhood of Soho with apocalyptic velocity.', tags: '#ghost-map', docs: true },
      { day: '21', mon: 'Sep', time: '9:48 PM', title: '3. Removing the Pump Handle', snip: 'On the evening of September 7, Snow presented his evidence to the Board of Guardians of St. James Parish.', tags: '#ghost-map', docs: false },
      { day: '18', mon: 'Sep', time: '8:05 AM', title: 'Welcome to Daylight Writer', snip: 'A distraction-free, landscape typewriter writing experience built for the Daylight Computer.', tags: '#daylight/welcome', docs: true }
    ].map((e) => Object.assign({}, e, {
      docsLabel: e.docs ? 'Docs' : 'Queued', pick: pickDoc,
      ring: e.active ? '0 0 0 2px var(--dot), var(--shadow)' : 'var(--shadow)'
    }));
    const tags = [{ t: '#ghost-map' }, { t: '#essays/drafts' }, { t: '#daylight/welcome' }, { t: '#getting-started' }];

    const seg = (opts, cur, key, face) => opts.map(([val, label]) => ({
      label, on: val === cur, pick: put({ [key]: val }), face: face ? F[val] : 'inherit',
      bg: val === cur ? 'var(--seg-on)' : 'transparent', sh: val === cur ? 'var(--seg-sh)' : 'none',
      fg: val === cur ? 'var(--ink)' : 'var(--ink-2)', w: val === cur ? 600 : 500
    }));
    const sw = (on) => ({ track: on ? 'var(--btn-bg)' : 'var(--seg-bg)', knob: on ? '24px' : '4px', knobBg: on ? 'var(--btn-ink)' : 'var(--ink-3)' });

    const fmt = this.v('fmt', 'md');
    const formats = [
      ['md', '.md', 'Markdown', 'Frontmatter, tags, notes as footnotes'],
      ['txt', '.txt', 'Plain text', 'Clean UTF-8, nothing else'],
      ['docx', '.docx', 'Word', 'Headings, margins, footnotes'],
      ['pdf', '.pdf', 'PDF', 'Typeset pages, ready to print']
    ].map(([id, ext, name, desc]) => ({ ext, name, desc, on: fmt === id, pick: put({ fmt: id }), ring: fmt === id ? '0 0 0 2px var(--ink)' : '0 0 0 1px var(--line)' }));
    const scope = this.v('scope', 'section');
    const tw = sw(this.on('typewriter', true));
    const fn = sw(this.on('footnotes', true));
    const tp = sw(this.on('titlePage', false));

    const focusNames = { sentence: 'Sentence', paragraph: 'Paragraph', off: 'Focus off' };
    const nextFocus = { sentence: 'paragraph', paragraph: 'off', off: 'sentence' };
    const syncLabels = { synced: 'Synced ' + syncedAt, syncing: 'Syncing 2…', offline: 'Offline · saved here', error: 'Sync paused · Retry' };
    const syncHeads = { synced: 'Up to date · last synced ' + syncedAt, syncing: 'Sending 2 changes…', offline: 'Offline — changes wait safely on this tablet', error: 'Google didn’t answer. We’ll retry in a minute.' };
    const log = [
      { at: '14:02:11', msg: 'Pushed 240 characters · 2. The Broad Street Pump' },
      { at: '14:02:09', msg: 'Paused 1.5 s · 1 change queued' },
      { at: '13:58:40', msg: 'Updated in place · 1. The Soho Outbreak' },
      { at: '13:58:31', msg: 'Found folder · Daylight Manuscripts' }
    ];
    if (syncedAt !== '14:02') log.unshift({ at: syncedAt + ':02', msg: 'Pushed 1 change · 2. The Broad Street Pump' });
    const ring = (k) => tk === k ? '0 0 0 2px var(--ink)' : '0 0 0 1px var(--line)';
    const isWrite = view === 'write';

    return {
      vars, glass: this.on('glass', false) ? 'grayscale(1)' : 'none',
      canvasRight: right ? 288 : 0, colMax: right ? 650 : 808, shiftY, ts, lh,
      lhLabel: lh.toFixed(2).replace(/0$/, ''),
      writeTrack: wf === 'sans' ? '-0.01em' : '0',
      headColor: focus === 'off' ? 'var(--ink)' : 'var(--dim)',
      isWrite, isScriv: view === 'scrivenings', isCork: view === 'corkboard', longForm: !isWrite,
      paras, actions, notes, intro, sections, cards,
      cardShadow: (indexCards || tk === 'hc') ? 'none' : 'var(--shadow)', noteShadow: (indexCards || tk === 'hc') ? 'none' : 'var(--shadow)',
      cardSeg: seg([['plain', 'Plain'], ['index', 'Index cards']], cardStyle, 'cards'),
      onHc: tk === 'hc', ringHc: ring('hc'),
      pickHc: put({ theme: 'hc', writeFont: 'auto', textSize: undefined }),
      rightOpen: right, marginHeadTop: chrome ? 68 : 12,
      chrome, left, right, leftOpen: left, whisper: !chrome && modal === 'none',
      whisperLabel: (isWrite ? '93 words' : '243 words') + ' · ' + focusNames[focus] + ' · tap for controls',
      crumb: isWrite ? 'Chapter 1 · ' + stamp('Draft') : (view === 'scrivenings' ? 'Scrivenings · 3 sections' : 'Corkboard · 3 cards'),
      docTitle: isWrite ? '2. The Broad Street Pump' : 'Chapter 1: The Outbreak & Broad Street',
      stats: isWrite ? '93 words · 1 min' : '243 words · 2 min',
      viewSeg: seg([['scrivenings', 'Text'], ['corkboard', 'Cards']], view, 'view'),
      isSynced: sync === 'synced', isSyncing: sync === 'syncing', isOffline: sync === 'offline', isError: sync === 'error',
      syncLabel: syncLabels[sync], syncHeadline: syncHeads[sync], log,
      focusName: focusNames[focus], focusDot: focus === 'sentence' ? 2.5 : (focus === 'paragraph' ? 4.5 : 0),
      bgLeft: left ? 'var(--press)' : 'transparent', bgRight: right ? 'var(--press)' : 'transparent',
      bgExport: modal === 'export' ? 'var(--press)' : 'transparent', bgSettings: modal === 'settings' ? 'var(--press)' : 'transparent',
      isBinder: libView === 'binder', isJournal: libView === 'journal', rows, entries, tags,
      libSeg: seg([['binder', 'Binder'], ['journal', 'Journal']], libView, 'libView'),
      anyModal: modal !== 'none', isSettings: modal === 'settings', isSync: modal === 'sync', isExport: modal === 'export',
      onSolos: tk === 'solos', onNight: tk === 'night', onJournal: tk === 'journal', onManuscript: tk === 'manuscript',
      ringSolos: ring('solos'), ringNight: ring('night'), ringJournal: ring('journal'), ringManuscript: ring('manuscript'),
      pickSolos: put({ theme: 'solos', writeFont: 'auto', textSize: undefined }),
      pickNight: put({ theme: 'night', writeFont: 'auto', textSize: undefined }),
      pickJournal: put({ theme: 'journal', writeFont: 'auto', textSize: undefined }),
      pickManuscript: put({ theme: 'manuscript', writeFont: 'auto', textSize: undefined }),
      fontSeg: seg([['mono', 'Mono'], ['sans', 'Sans'], ['serif', 'Serif']], wf, 'writeFont', true),
      focusSeg: seg([['sentence', 'Sentence'], ['paragraph', 'Paragraph'], ['off', 'Off']], focus, 'focus'),
      scopeSeg: seg([['section', 'This section'], ['chapter', 'Whole chapter']], scope, 'scope'),
      pageSeg: seg([['letter', 'Letter'], ['a4', 'A4'], ['dc1', 'DC1 4:3']], this.v('page', 'dc1'), 'page'),
      exportSubject: scope === 'section' ? '2. The Broad Street Pump · 93 words' : 'Chapter 1: The Outbreak & Broad Street · 3 sections, 243 words',
      formats, pageOpacity: (fmt === 'docx' || fmt === 'pdf') ? 1 : 0.4,
      typewriter: this.on('typewriter', true), twTrack: tw.track, twKnob: tw.knob, twKnobBg: tw.knobBg,
      footnotes: this.on('footnotes', true), fnTrack: fn.track, fnKnob: fn.knob, fnKnobBg: fn.knobBg,
      titlePage: this.on('titlePage', false), tpTrack: tp.track, tpKnob: tp.knob, tpKnobBg: tp.knobBg,
      tokenOpen: this.on('tokenOpen', false), tokenChev: this.on('tokenOpen', false) ? 'rotate(90deg)' : 'none',
      toggleLeft: put({ left: !left, modal: 'none' }), closeLeft: put({ left: false }),
      toggleRight: put({ right: !right, view: 'write' }),
      openSettings: put({ modal: 'settings', left: false }), openSync: put({ modal: 'sync', left: false }),
      openExport: put({ modal: 'export', left: false }), closeModal: put({ modal: 'none' }),
      cycleFocus: put({ focus: nextFocus[focus] }),
      hideChrome: put({ chrome: false, left: false, right: false, modal: 'none', ai: 'none' }),
      showChrome: put({ chrome: true }),
      dismissAi: put({ ai: 'none' }), applyCrit: put({ ai: 'none', critApplied: true }),
      toggleTypewriter: put({ typewriter: !this.on('typewriter', true) }),
      toggleFootnotes: put({ footnotes: !this.on('footnotes', true) }),
      toggleTitlePage: put({ titlePage: !this.on('titlePage', false) }),
      toggleToken: put({ tokenOpen: !this.on('tokenOpen', false) }),
      onSize: (e) => this.setState({ textSize: Number(e.target.value) }),
      onLeading: (e) => this.setState({ leading: Number(e.target.value) }),
      syncNow: () => {
        clearTimeout(this._t);
        this.setState({ sync: 'syncing' });
        this._t = setTimeout(() => this.setState({ sync: 'synced', syncedAt: '14:03' }), 1800);
      }
    };
  }
}
