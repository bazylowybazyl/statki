// src/3d/proxyTurretFrame.js
//
// Wieże proxy statków ruchu v2 tej klatki (E17b): ShipProxyBatch3D (src/3d/shipProxyBatch3D.js) wypełnia listę grup
// w swojej klatce, syncShipModels3D (src/3d/ships3d/shipModels3DGame.js — idzie po proxy, strona i worker) dokłada je
// do partii wież tak jak rekordy Turret2D encji. Grupa = jedno proxy: { holder: { turrets: Map, assets: null } — stan
// wież (pochylenie, LOD), view: { x, y, angle, isTrafficProxy }, recs: rekordy jak Turret2D (key, weaponId, spec.r,
// scale, wx, wy, ang, recoil, state) }. Moduł bez zależności — oba moduły go importują.
export const ProxyTurretFrame = {
  list: [],
  count: 0
};
