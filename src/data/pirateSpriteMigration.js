// Legacy editor positions use the original PNG pixels. Keep saved custom layouts
// when switching to the v2 sprites; unchanged preset markers follow the new mounts.
const REVISIONS = {
  pirate_battleship: {
    from: [1158,632], to: [1727,911],
    markers: {
      m_p5pgvkj: [-145.47,-105.35,-235.5,-189.5],
      m_92mp3nj: [-143.97,109.85,-235.5,194.5],
      m_wsxghs2: [268.45,-1.87,570.5,5.5],
      m_vpidpf9: [119.98,140.6,309.5,187.5],
      m_42v3ntq: [115.48,-141.35,309.5,-180.5],
      m_m5m6eqq: [303.21,-94.04,474.5,-118.5],
      m_rik6o0v: [303.21,94.04,474.5,117.5],
      m_e5sllp3: [218.84,-122.16,440.5,-189.5],
      m_c3vevjg: [218.84,122.16,440.5,190.5],
      m_y9aspbk: [-21.09,-137.1,-72.5,-152.5],
      m_bar4xf8: [-21.09,137.1,-72.5,157.5],
      m_c35kkmu: [-164.35,-169.62,-357.5,-340.5],
      m_oekr20o: [-164.35,169.62,-357.5,342.5],
      m_su8eq18: [-101.07,-143.26,-188.5,-245.5],
      m_svc3mqq: [-101.07,143.26,-188.5,242.5],
      m_v034d1y: [41.31,-141.5,95.5,-152.5],
      m_ilidmdw: [41.31,141.5,95.5,157.5],
      m_ggf5qyn: [373.52,-5.27,687.5,1.5],
      m_ny1a0ou: [-362.97,1.76,-513.5,0.5],
      m_llge2x6: [-457.41,-61.86,-763.5,-95.5],
      m_lftjcis: [-440.92,-143.6,-763.5,-235.5],
      m_lrnj6rk: [-459.66,64.11,-763.5,104.5],
      m_25d19is: [-437.92,145.85,-763.5,244.5]
    }
  },
  pirate_destroyer: {
    from: [768,419], to: [1840,854],
    markers: {
      m_bcebjuk: [-100,-70,-316,-191],
      m_39mwmxa: [-100,70,-316,181],
      m_1bc3qth: [80,-90,281,-144],
      m_z113tre: [80,90,281,133],
      m_ko6m00t: [180,0,588,0],
      m_hmqbxtf: [0,-90,-22,-127],
      m_94e2ygy: [170,-50,475,-86],
      m_evoydld: [150,50,475,91],
      m_wnjmjff: [0,80,-22,126],
      m_cjalknc: [-150,-140,-457,-290],
      m_9uaokjc: [-100,-110,-220,-97],
      m_0noahgf: [130,-80,391,-148],
      m_282pr8w: [220,-40,700,-42],
      m_ax1tlot: [220,30,700,42],
      m_j3wwkcu: [130,70,391,135],
      m_l2rsz9i: [-110,110,-220,103],
      m_4nouhl5: [-170,140,-457,277],
      m_w5p35hz: [-110,140,-361,292],
      m_5wadff7: [-180,-90,-490,-156]
    }
  },
  pirate_frigate: {
    from: [2816,1536], to: [1942,809],
    markers: {
      m_4v77ihm: [-350,-260,-347,-164.5],
      m_ci5m2rh: [-350,260,-347,209.5],
      m_gcbrgg7: [650,-10,553,20.5],
      m_g7uxhw9: [340,-290,374,-97.5],
      m_aj8zp4w: [270,-290,259,-97.5],
      m_uwsfum4: [210,-290,129,-84.5],
      m_hbojo1e: [130,-290,-1,-94.5],
      m_eootp8f: [360,300,374,137.5],
      m_q1wnmuq: [310,300,259,137.5],
      m_zs01sam: [250,300,129,129.5],
      m_f8ye86b: [-330,440,-269,172.5],
      m_ic925ij: [-400,570,-405,281.5],
      m_6i79izv: [-610,550,-520,249.5],
      m_v6v9gwh: [-960,150,-627,72.5],
      m_lr3rzrr: [-960,10,-644,16.5],
      m_j9cdixd: [-950,-140,-616,-43.5],
      m_a1518wf: [-850,10,-215,17.5],
      m_i19wlt4: [-340,-390,-262,-80.5],
      m_uars2jw: [-490,-390,-464,-211.5],
      m_y4mc84p: [-990,-350,-856,-133.5],
      m_jred6j8: [-990,360,-856,176.5],
      m_9x86ohy: [440,-300,339,-119.5],
      m_u59faf5: [440,300,339,158.5]
    }
  }
};

/** Pure, idempotent migration shared by the player, NPCs and layout editor. */
export function migratePirateSpriteLayout(id, layout) {
  const rev = REVISIONS[id];
  if (!rev || !layout || typeof layout !== 'object' || Number(layout.spriteRevision) >= 2) return layout;
  const sx = rev.to[0] / rev.from[0];
  const sy = rev.to[1] / rev.from[1];
  const scaleMarker = (p) => {
    if (!p || typeof p !== 'object') return p;
    const next = { ...p };
    const preset = rev.markers[p.id];
    const unchanged = preset && Math.abs(p.x - preset[0]) < 0.01 && Math.abs(p.y - preset[1]) < 0.01;
    for (const [key, scale] of [['x', sx], ['y', sy], ['w', sx], ['h', sy], ['offsetX', sx], ['offsetY', sy], ['r', (sx + sy) / 2]]) {
      if (typeof p[key] === 'number') next[key] = p[key] * scale;
    }
    if (unchanged) {
      next.x = preset[2]; next.y = preset[3];
      // The old frigate side thrusters had a 90 px extra nozzle offset.
      if (id === 'pirate_frigate' && (p.id === 'm_9x86ohy' || p.id === 'm_u59faf5') && p.offsetX === 90) next.offsetX = 0;
    }
    if (Array.isArray(p.poly)) next.poly = p.poly.map(([x, y]) => [x * sx, y * sy]);
    return next;
  };
  const next = { ...layout, spriteRevision: 2 };
  for (const key of ['hardpoints', 'cores', 'bridges']) {
    if (Array.isArray(layout[key])) next[key] = layout[key].map(scaleMarker);
  }
  for (const key of ['engines', 'lights']) {
    if (!layout[key] || typeof layout[key] !== 'object') continue;
    next[key] = { ...layout[key] };
    for (const [kind, markers] of Object.entries(layout[key])) {
      if (Array.isArray(markers)) next[key][kind] = markers.map(scaleMarker);
    }
  }
  return next;
}
