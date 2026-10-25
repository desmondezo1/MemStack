// Sarah, the film's main character: a flat illustration built from moving parts, in three views.
//   front: ¾ bust (kitchen, customer call)   profile: side bust (bus)   back: from behind at her desk
// makeSarah(parent, view) returns { el, set(pose) }. A pose is plain numbers, so a frame is a
// pure function of time. Classic script (no modules), so the page works from file://.
(function () {
  const C = {
    skin: '#8a5a3c', skinShade: '#74482f', hair: '#211915', hairHi: '#33261f', teal: '#2f6f73', tealShade: '#255a5d',
    top: '#f3e9dc', glasses: '#24201d', gold: '#d9a441', lips: '#5c2e20', white: '#ffffff', ink: '#1d1d1f', chair: '#3a3f48', chairHi: '#4a505b',
  };
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  const svgEl = (w, h, inner) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('width', w); s.setAttribute('height', h); s.innerHTML = inner; return s; };
  const q = (root, id) => root.querySelector(`[data-p="${id}"]`);
  const T = (node, tf) => { if (node) node.setAttribute('transform', tf); };

  // ---- Front ¾ bust (400 × 520) ----------------------------------------------------------
  function front() {
    return `
    <g data-p="body">
      <path d="M58 520 C66 392 118 318 200 314 C282 318 334 392 342 520 Z" fill="${C.teal}"/>
      <path d="M150 318 C170 352 182 372 200 392 C218 372 230 352 250 318 C232 312 168 312 150 318 Z" fill="${C.top}"/>
      <path d="M200 392 L200 520" stroke="${C.tealShade}" stroke-width="3"/>
      <rect x="181" y="250" width="38" height="74" rx="14" fill="${C.skinShade}"/>
      <g data-p="armL"><path d="M96 380 C70 430 66 480 80 520 L132 520 C124 470 128 432 140 400 Z" fill="${C.tealShade}"/></g>
    </g>
    <g data-p="head">
      <ellipse cx="200" cy="92" rx="96" ry="80" fill="${C.hair}"/>
      <ellipse cx="170" cy="70" rx="40" ry="22" fill="${C.hairHi}" opacity=".6"/>
      <ellipse cx="134" cy="196" rx="13" ry="18" fill="${C.skinShade}"/>
      <circle cx="134" cy="222" r="7" fill="none" stroke="${C.gold}" stroke-width="3"/>
      <ellipse cx="204" cy="190" rx="68" ry="80" fill="${C.skin}"/>
      <path d="M136 168 C140 120 176 104 210 106 C246 108 272 128 274 168 C258 142 230 134 204 134 C176 134 150 146 136 168 Z" fill="${C.hair}"/>
      <g data-p="brows"><path data-p="browL" d="M168 158 Q180 152 192 156" stroke="${C.hair}" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path data-p="browR" d="M218 156 Q230 152 242 158" stroke="${C.hair}" stroke-width="5" fill="none" stroke-linecap="round"/></g>
      <g data-p="eyes"><ellipse data-p="eyeL" cx="181" cy="184" rx="5.5" ry="6.5" fill="${C.ink}"/><ellipse data-p="eyeR" cx="230" cy="184" rx="5.5" ry="6.5" fill="${C.ink}"/></g>
      <g fill="none" stroke="${C.glasses}" stroke-width="3.5"><rect x="160" y="166" width="42" height="36" rx="16"/><rect x="210" y="166" width="42" height="36" rx="16"/><path d="M202 182 Q206 178 210 182"/><path d="M160 180 L142 176"/></g>
      <path d="M206 196 Q210 214 200 220" stroke="${C.skinShade}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path data-p="mouth" d="M186 236 Q204 248 222 236" stroke="${C.lips}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="172" cy="214" rx="12" ry="7" fill="#c46a4a" opacity=".22"/><ellipse cx="240" cy="214" rx="12" ry="7" fill="#c46a4a" opacity=".22"/>
      <g data-p="headset" opacity="0"><path d="M128 190 C120 110 290 100 280 190" stroke="${C.ink}" stroke-width="9" fill="none"/><rect x="118" y="176" width="22" height="38" rx="9" fill="${C.ink}"/><path d="M130 210 Q140 250 180 246" stroke="${C.ink}" stroke-width="5" fill="none"/><circle cx="182" cy="246" r="6" fill="${C.ink}"/></g>
    </g>
    <g data-p="armR">
      <path d="M300 392 C330 430 336 470 330 520 L276 520 C276 476 274 440 266 410 Z" fill="${C.tealShade}"/>
      <g data-p="mugHand">
        <rect x="236" y="404" width="56" height="62" rx="10" fill="${C.white}"/><path d="M292 418 C312 418 312 450 292 450" stroke="${C.white}" stroke-width="9" fill="none"/>
        <rect x="236" y="404" width="56" height="12" rx="6" fill="#e9d9c8"/><path d="M252 396 Q256 384 252 372 M268 396 Q272 384 268 372" data-p="steam" stroke="#cfc4b8" stroke-width="3" fill="none" stroke-linecap="round"/>
        <ellipse cx="232" cy="440" rx="20" ry="16" fill="${C.skin}"/>
      </g>
    </g>`;
  }

  // ---- Side profile bust, facing right (400 × 520) -----------------------------------------
  function profile() {
    return `
    <g data-p="body">
      <path d="M90 520 C96 400 140 330 210 320 C268 326 300 390 306 520 Z" fill="${C.teal}"/>
      <rect x="186" y="252" width="40" height="80" rx="16" fill="${C.skinShade}"/>
    </g>
    <g data-p="head">
      <ellipse cx="168" cy="110" rx="100" ry="84" fill="${C.hair}"/>
      <ellipse cx="140" cy="86" rx="40" ry="22" fill="${C.hairHi}" opacity=".6"/>
      <path d="M150 140 C170 112 226 110 262 140 C278 160 282 176 278 190 L292 214 C296 222 290 226 282 226 L280 246 C278 270 254 284 226 280 C190 276 160 252 152 214 Z" fill="${C.skin}"/>
      <path d="M150 140 C170 112 226 108 262 136 C244 132 220 136 198 152 C180 166 166 186 160 214 Z" fill="${C.hair}"/>
      <ellipse cx="190" cy="206" rx="13" ry="18" fill="${C.skinShade}"/><circle cx="190" cy="232" r="7" fill="none" stroke="${C.gold}" stroke-width="3"/>
      <path data-p="browR" d="M236 168 Q250 162 264 168" stroke="${C.hair}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <g data-p="eyes"><ellipse data-p="eyeR" cx="252" cy="192" rx="5" ry="6.5" fill="${C.ink}"/></g>
      <g fill="none" stroke="${C.glasses}" stroke-width="3.5"><rect x="234" y="176" width="36" height="34" rx="14"/><path d="M234 190 L196 186"/></g>
      <path data-p="mouth" d="M262 250 Q272 254 280 248" stroke="${C.lips}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    </g>
    <g data-p="armR">
      <path d="M220 360 C250 400 262 430 300 446 L292 470 C250 462 222 432 200 396 Z" fill="${C.tealShade}"/>
      <g data-p="phone"><rect x="292" y="396" width="34" height="62" rx="7" fill="${C.ink}"/><rect x="296" y="402" width="26" height="48" rx="4" fill="#9fd3ff" opacity=".85"/><ellipse cx="300" cy="452" rx="14" ry="12" fill="${C.skin}"/></g>
    </g>`;
  }

  // ---- From behind, at a desk (400 × 520) ---------------------------------------------------
  function back() {
    return `
    <g data-p="chairBack"><rect x="96" y="300" width="208" height="230" rx="40" fill="${C.chair}"/><rect x="110" y="312" width="180" height="40" rx="18" fill="${C.chairHi}"/></g>
    <g data-p="torso">
      <path d="M82 470 C86 372 130 316 200 312 C270 316 314 372 318 470 Z" fill="${C.teal}"/>
      <path d="M200 316 L200 470" stroke="${C.tealShade}" stroke-width="3"/>
      <g data-p="armL"><path d="M100 360 C70 380 60 410 70 440 L104 452 C104 424 112 400 128 384 Z" fill="${C.tealShade}"/></g>
      <g data-p="armR"><path d="M300 360 C330 380 340 410 330 440 L296 452 C296 424 288 400 272 384 Z" fill="${C.tealShade}"/>
        <g data-p="handUp" opacity="0"><path d="M300 360 C336 332 340 270 296 228 L276 244 C306 278 300 320 276 346 Z" fill="${C.tealShade}"/><ellipse cx="282" cy="228" rx="20" ry="18" fill="${C.skin}"/></g>
        <g data-p="mugUp" opacity="0"><path d="M300 360 C340 340 344 300 318 270 L298 282 C314 304 312 330 288 346 Z" fill="${C.tealShade}"/><rect x="300" y="236" width="44" height="50" rx="8" fill="${C.white}"/><path d="M314 230 Q318 218 314 206" stroke="#cfc4b8" stroke-width="3" fill="none"/><ellipse cx="304" cy="270" rx="16" ry="14" fill="${C.skin}"/></g>
      </g>
      <rect x="182" y="256" width="36" height="62" rx="14" fill="${C.skinShade}"/>
      <g data-p="head">
        <ellipse cx="200" cy="200" rx="66" ry="74" fill="${C.hair}"/>
        <ellipse cx="200" cy="112" rx="98" ry="84" fill="${C.hair}"/>
        <ellipse cx="172" cy="88" rx="42" ry="24" fill="${C.hairHi}" opacity=".55"/>
        <ellipse cx="132" cy="206" rx="12" ry="17" fill="${C.skinShade}"/><ellipse cx="268" cy="206" rx="12" ry="17" fill="${C.skinShade}"/>
        <circle cx="132" cy="232" r="7" fill="none" stroke="${C.gold}" stroke-width="3"/><circle cx="268" cy="232" r="7" fill="none" stroke="${C.gold}" stroke-width="3"/>
        <path d="M136 196 L118 192 M264 196 L282 192" stroke="${C.glasses}" stroke-width="3.5"/>
        <g data-p="headset" opacity="0"><path d="M124 210 C112 120 288 120 276 210" stroke="${C.ink}" stroke-width="9" fill="none"/><rect x="112" y="196" width="22" height="38" rx="9" fill="${C.ink}"/><rect x="266" y="196" width="22" height="38" rx="9" fill="${C.ink}"/></g>
      </g>
    </g>`;
  }

  const VIEWS = { front, profile, back };
  window.makeSarah = function makeSarah(parent, view) {
    const svg = svgEl(400, 520, VIEWS[view]());
    svg.style.overflow = 'visible';
    const wrap = document.createElement('div');
    wrap.className = `abs sarah sarah-${view}`;
    wrap.style.width = '400px'; wrap.style.height = '520px'; wrap.style.transformOrigin = '50% 100%';
    wrap.appendChild(svg);
    parent.appendChild(wrap);
    const id = ++uid;
    // pose: x, y, s (scale), o, lean (deg, whole body), head (deg), nod (px), blink 0..1, look [-1..1],
    // mood: 'happy' | 'neutral' | 'tired' | 'frown' | 'talk' (talk opens the mouth with `talk` 0..1),
    // sip 0..1 (front: mug to mouth), headset 0..1, slump 0..1 (back: hunched), handToHead 0..1 (back),
    // leanBack 0..1 (back: relaxed with mug), type 0..1 (back: typing motion phase), phoneUp 0..1 (profile)
    function set(p) {
      const { x = 0, y = 0, s = 1, o = 1, lean = 0, head = 0, nod = 0, blink = 0, look = 0, mood = 'neutral', talk = 0 } = p;
      wrap.style.transform = `translate(${x}px, ${y}px) rotate(${lean}deg) scale(${s})`;
      wrap.style.opacity = o;
      wrap.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
      const headG = q(svg, 'head');
      if (view === 'back') {
        const slump = p.slump || 0, hth = p.handToHead || 0, lb = p.leanBack || 0;
        T(q(svg, 'torso'), `translate(0 ${slump * 14 - lb * 6}) rotate(${-lb * 4} 200 470)`);
        T(headG, `translate(${hth * 10} ${slump * 26 + nod}) rotate(${head + hth * 12 - lb * 6} 200 300)`);
        const type = Math.sin((p.type || 0) * Math.PI * 2) * (1 - hth) * (1 - lb);
        T(q(svg, 'armL'), `translate(0 ${type * 3})`);
        q(svg, 'armR').querySelector('path').style.opacity = 1 - Math.max(hth, lb);
        q(svg, 'handUp').style.opacity = hth;
        q(svg, 'mugUp').style.opacity = lb;
        q(svg, 'headset').style.opacity = p.headset || 0;
        return;
      }
      // The head sits low on the shoulders: a short neck reads friendlier.
      T(headG, `translate(0 ${nod + 34}) rotate(${head} 200 300)`);
      const open = Math.max(0.08, 1 - blink);
      ['eyeL', 'eyeR'].forEach(e => { const n = q(svg, e); if (n) { n.setAttribute('ry', (6.5 * open).toFixed(2)); n.style.transform = `translateX(${look * 3}px)`; } });
      const brow = { happy: [-2, 0], neutral: [0, 0], tired: [4, 8], frown: [6, -10], talk: [-2, 0] }[mood] || [0, 0];
      const bl = q(svg, 'browL'), br = q(svg, 'browR');
      if (bl) T(bl, `translate(0 ${brow[0]}) rotate(${brow[1]} 180 156)`);
      if (br) T(br, `translate(0 ${brow[0]}) rotate(${-brow[1]} 230 156)`);
      const m = q(svg, 'mouth');
      if (view === 'front') {
        const d = mood === 'happy' ? 'M184 234 Q204 252 224 234' : mood === 'tired' ? 'M188 240 Q204 236 220 240' : mood === 'frown' ? 'M188 244 Q204 234 220 244'
          : mood === 'talk' ? `M186 236 Q204 ${244 + talk * 12} 222 236` : 'M186 236 Q204 246 222 236';
        m.setAttribute('d', d);
        m.setAttribute('fill', mood === 'talk' && talk > 0.2 ? C.lips : 'none');
        const sip = p.sip || 0;
        T(q(svg, 'mugHand'), `translate(${-sip * 30} ${-sip * 200})`);
        q(svg, 'steam').style.opacity = p.steam ?? 1;
        q(svg, 'mugHand').style.opacity = p.mug ?? 1;
        q(svg, 'headset').style.opacity = p.headset || 0;
      } else {
        m.setAttribute('d', mood === 'happy' ? 'M260 248 Q272 258 282 246' : 'M262 250 Q272 254 280 248');
        T(q(svg, 'phone'), `translate(${-(1 - (p.phoneUp ?? 1)) * 20} ${(1 - (p.phoneUp ?? 1)) * 60})`);
      }
    }
    return { el: wrap, set, id };
  };
  window.SARAH_COLORS = C;
})();
