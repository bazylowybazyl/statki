// Panel wydajnosci gry: pomiar czasow klatki + zaleznych sekcji (fizyka, AI, render)
// i jego wlasny DOM. Wyciagniete 1:1 z index.html — styl w assets/css/perf-hud.css.
//
// Panel czyta stan swiata (statek gracza, NPC, wraki, pociski, most fizyki) przez
// wstrzykiwany provider, zeby nie zalezec od modulowych zmiennych glownego skryptu.
import { getHexArenaStats } from '../game/destructor.js';

const PERF_PANEL_HTML = `
<div id="perfPanel" class="hidden">
  <div class="perf-title">WYDAJNOSC <span style="float:right;color:#556">[P] toggle</span></div>
  <div class="perf-fps good" id="perfFps">--</div>
  <div style="color:#556;font-size:10px;margin-bottom:6px" id="perfFrameTime">-- ms/frame</div>
  <div class="perf-row"><span class="perf-label">Frame p50 / p95</span><span class="perf-val" id="perfFramePercentiles">--</span></div>
  <div class="perf-row"><span class="perf-label">HexArena</span><span class="perf-val" id="perfHexArena">--</span></div>
  <div class="perf-row"><span class="perf-label">Hex LOD full/hybrid/far</span><span class="perf-val" id="perfHexLod">--</span></div>
  <div class="perf-row"><span class="perf-label">Culling rys./odrzuc. (cienie)</span><span class="perf-val" id="perfCulling">--</span></div>
  <div class="perf-row"><span class="perf-label">Physics worker</span><span class="perf-val" id="perfPhysicsWorker">--</span></div>
  <div class="perf-row"><span class="perf-label">AI cadence actual/target</span><span class="perf-val" id="perfAiCadence">--</span></div>
  <div class="perf-row"><span class="perf-label">Untracked</span><span class="perf-val" id="perfFrameUntracked">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barFrameUntracked" style="width:0%;background:#64748b"></div>
  </div>
  <div class="perf-controls">
    <button class="perf-btn" id="perfColStart" type="button">COL Start</button>
    <button class="perf-btn stop" id="perfColStop" type="button">COL Stop</button>
    <button class="perf-btn" id="perfRenderStart" type="button">Render Start</button>
    <button class="perf-btn stop" id="perfRenderStop" type="button">Render Stop</button>
    <button class="perf-btn" id="perfAiStart" type="button">AI Start</button>
    <button class="perf-btn stop" id="perfAiStop" type="button">AI Stop</button>
  </div>
  <div class="perf-sep"></div>

  <div class="perf-row perf-section-toggle" data-perf-toggle="physics" role="button" tabindex="0"><span class="perf-label"><span class="perf-caret" data-perf-caret="physics">+</span>Fizyka</span><span class="perf-val" id="perfPhysics">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barPhysics" style="width:0%;background:#4af"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Destructor</span><span class="perf-val"
      id="perfDestructor">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barDestructor" style="width:0%;background:#6cf"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Kolizje</span><span class="perf-val"
      id="perfCollisions">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barCollisions" style="width:0%;background:#f84"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Deformacja</span><span class="perf-val" id="perfDeform">--</span>
  </div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barDeform" style="width:0%;background:#8f4"></div>
  </div>

  <div class="perf-row perf-section-toggle" data-perf-toggle="ai" role="button" tabindex="0"><span class="perf-label"> |- <span class="perf-caret" data-perf-caret="ai">+</span>AI</span><span class="perf-val" id="perfAi">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAi" style="width:0%;background:#c084fc"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI squads</span><span class="perf-val" id="perfAiSquads">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiSquads" style="width:0%;background:#a78bfa"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI support</span><span class="perf-val" id="perfAiSupportWing">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiSupportWing" style="width:0%;background:#c084fc"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI npcStep</span><span class="perf-val" id="perfAiNpcStep">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiNpcStep" style="width:0%;background:#d8b4fe"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI grid</span><span class="perf-val" id="perfAiNpcGrid">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiNpcGrid" style="width:0%;background:#7dd3fc"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI enemy</span><span class="perf-val" id="perfAiNpcEnemyBrain">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiNpcEnemyBrain" style="width:0%;background:#fb7185"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI ally</span><span class="perf-val" id="perfAiNpcFriendlyBrain">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiNpcFriendlyBrain" style="width:0%;background:#38bdf8"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI other</span><span class="perf-val" id="perfAiNpcOther">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiNpcOther" style="width:0%;background:#a3a3a3"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI mission</span><span class="perf-val" id="perfAiPirateMission">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiPirateMission" style="width:0%;background:#e879f9"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI sep</span><span class="perf-val" id="perfAiSeparation">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiSeparation" style="width:0%;background:#f0abfc"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI scan</span><span class="perf-val" id="perfAiWeaponScan">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiWeaponScan" style="width:0%;background:#f5d0fe"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- AI target</span><span class="perf-val" id="perfAiTargetPick">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barAiTargetPick" style="width:0%;background:#f472b6"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Pre-AI</span><span class="perf-val" id="perfPreAi">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barPreAi" style="width:0%;background:#60a5fa"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- World/zone</span><span class="perf-val" id="perfWorldZone">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barWorldZone" style="width:0%;background:#38bdf8"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Player sys</span><span class="perf-val" id="perfPlayerSystems">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barPlayerSystems" style="width:0%;background:#22c55e"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Scan/UI</span><span class="perf-val" id="perfScanUi">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barScanUi" style="width:0%;background:#818cf8"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Player fly</span><span class="perf-val" id="perfPlayerFlight">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barPlayerFlight" style="width:0%;background:#14b8a6"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Wrecks</span><span class="perf-val" id="perfWreckPrep">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barWreckPrep" style="width:0%;background:#84cc16"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Pociski</span><span class="perf-val" id="perfProjectiles">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barProjectiles" style="width:0%;background:#fb7185"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- CIWS</span><span class="perf-val" id="perfCiws">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barCiws" style="width:0%;background:#f59e0b"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B grid</span><span class="perf-val" id="perfBulletGrid">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletGrid" style="width:0%;background:#f97316"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B VFX</span><span class="perf-val" id="perfBulletMoveVfx">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletMoveVfx" style="width:0%;background:#eab308"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B CIWS hit</span><span class="perf-val" id="perfBulletIntercept">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletIntercept" style="width:0%;background:#ec4899"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B NPC hit</span><span class="perf-val" id="perfBulletNpcHit">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletNpcHit" style="width:0%;background:#ef4444"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B ast</span><span class="perf-val" id="perfBulletAsteroids">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletAsteroids" style="width:0%;background:#a855f7"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B ring</span><span class="perf-val" id="perfBulletRing">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletRing" style="width:0%;background:#06b6d4"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- B misc</span><span class="perf-val" id="perfBulletMiscHits">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barBulletMiscHits" style="width:0%;background:#f43f5e"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- NPC fire</span><span class="perf-val" id="perfNpcFire">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barNpcFire" style="width:0%;background:#fb923c"></div>
  </div>

  <div class="perf-row"><span class="perf-label">     |- NPC scan</span><span class="perf-val" id="perfNpcFireScan">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barNpcFireScan" style="width:0%;background:#fdba74"></div>
  </div>

  <div class="perf-row"><span class="perf-label">     |- NPC spawn</span><span class="perf-val" id="perfNpcFireSpawn">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barNpcFireSpawn" style="width:0%;background:#f97316"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Destr prep</span><span class="perf-val" id="perfDestructiblePrep">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barDestructiblePrep" style="width:0%;background:#facc15"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Hardpointy</span><span class="perf-val" id="perfHardpoints">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barHardpoints" style="width:0%;background:#34d399"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- HUD/nav</span><span class="perf-val" id="perfHudNav">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barHudNav" style="width:0%;background:#a3e635"></div>
  </div>

  <div class="perf-row perf-section-toggle" data-perf-toggle="render" role="button" tabindex="0"><span class="perf-label"><span class="perf-caret" data-perf-caret="render">-</span>Rysowanie</span><span class="perf-val" id="perfDraw">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barDraw" style="width:0%;background:#f4f"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R prep</span><span class="perf-val" id="perfRenderPrep">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRenderPrep" style="width:0%;background:#f0abfc"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R 3D upd</span><span class="perf-val" id="perfRender3dUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dUpdate" style="width:0%;background:#c084fc"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U planets</span><span class="perf-val" id="perfRender3dPlanetsUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dPlanetsUpdate" style="width:0%;background:#38bdf8"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U rings</span><span class="perf-val" id="perfRender3dRingsUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dRingsUpdate" style="width:0%;background:#22d3ee"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U stations</span><span class="perf-val" id="perfRender3dStationsUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dStationsUpdate" style="width:0%;background:#14b8a6"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U world</span><span class="perf-val" id="perfRender3dWorldUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dWorldUpdate" style="width:0%;background:#84cc16"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U ast</span><span class="perf-val" id="perfRender3dAsteroidsUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dAsteroidsUpdate" style="width:0%;background:#f59e0b"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U destr3D</span><span class="perf-val" id="perfRender3dDestructionUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dDestructionUpdate" style="width:0%;background:#fb7185"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U hex</span><span class="perf-val" id="perfRender3dHexUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dHexUpdate" style="width:0%;background:#a78bfa"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- U shields</span><span class="perf-val" id="perfRender3dShieldsUpdate">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dShieldsUpdate" style="width:0%;background:#f472b6"></div>
  </div>

  <div class="perf-row perf-section-toggle" data-perf-toggle="render3dDraw" role="button" tabindex="0"><span class="perf-label"> |- <span class="perf-caret" data-perf-caret="render3dDraw">-</span>R 3D draw</span><span class="perf-val" id="perfRender3dDraw">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dDraw" style="width:0%;background:#a855f7"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Core call</span><span class="perf-val" id="perfRender3dCoreCall">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dCoreCall" style="width:0%;background:#9333ea"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Core render</span><span class="perf-val" id="perfRender3dCoreRender">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dCoreRender" style="width:0%;background:#7e22ce"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Composer</span><span class="perf-val" id="perfRender3dComposer">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dComposer" style="width:0%;background:#c026d3"></div>
  </div>

  <div class="perf-row"><span class="perf-label">   |- Blit2D</span><span class="perf-val" id="perfRender3dBlit">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender3dBlit" style="width:0%;background:#d946ef"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R world2D</span><span class="perf-val" id="perfRender2dWorld">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dWorld" style="width:0%;background:#22d3ee"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R NPC</span><span class="perf-val" id="perfRender2dNpc">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dNpc" style="width:0%;background:#38bdf8"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R player</span><span class="perf-val" id="perfRender2dPlayer">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dPlayer" style="width:0%;background:#2dd4bf"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R wiezyczki</span><span class="perf-val" id="perfRender2dTurret">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dTurret" style="width:0%;background:#93a6c4"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R bullets</span><span class="perf-val" id="perfRender2dProjectiles">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dProjectiles" style="width:0%;background:#fb7185"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R VFX</span><span class="perf-val" id="perfRender2dVfx">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRender2dVfx" style="width:0%;background:#fbbf24"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R HUD</span><span class="perf-val" id="perfRenderHud">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRenderHud" style="width:0%;background:#84cc16"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- R UI/end</span><span class="perf-val" id="perfRenderUi">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barRenderUi" style="width:0%;background:#e879f9"></div>
  </div>

  <div class="perf-row"><span class="perf-label"> |- Overlay FX 3D</span><span class="perf-val" id="perfOverlayFx">--</span></div>
  <div class="perf-bar-bg">
    <div class="perf-bar" id="barOverlayFx" style="width:0%;background:#fb923c"></div>
  </div>

  <div class="perf-sep"></div>
  <div class="perf-row"><span class="perf-label">Shardy (aktywne)</span><span class="perf-val"
      id="perfShards">--</span></div>
  <div class="perf-row"><span class="perf-label">Kontakty/klatka</span><span class="perf-val"
      id="perfContacts">--</span></div>
  <div class="perf-row"><span class="perf-label">GPU (klatka)</span><span class="perf-val"
      id="perfGpuFrame">--</span></div>
  <div class="perf-row"><span class="perf-label">Obiekty sceny</span><span class="perf-val"
      id="perfSceneObjects">--</span></div>
  <div class="perf-row"><span class="perf-label">Draw calls / Tris</span><span class="perf-val"
      id="perfDrawCalls">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Refraction</span><span class="perf-val"
      id="perfDrawCallsRefraction">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- BG</span><span class="perf-val"
      id="perfDrawCallsBg">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Planets</span><span class="perf-val"
      id="perfDrawCallsPlanets">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Shafts</span><span class="perf-val"
      id="perfDrawCallsShafts">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Ortho</span><span class="perf-val"
      id="perfDrawCallsOrtho">--</span></div>
  <div class="perf-row"><span class="perf-label">   |- dysze/statki/wraki/blyski</span><span class="perf-val"
      id="perfDrawCallsCategories">--</span></div>
  <div class="perf-row"><span class="perf-label">   |- smugi (zwiniete ciala)</span><span class="perf-val"
      id="perfDrawCallsImpostors">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- FG</span><span class="perf-val"
      id="perfDrawCallsFg">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Bloom</span><span class="perf-val"
      id="perfDrawCallsBloom">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Post</span><span class="perf-val"
      id="perfDrawCallsPost">--</span></div>
  <div class="perf-row"><span class="perf-label"> |- Other</span><span class="perf-val"
      id="perfDrawCallsOther">--</span></div>
  <div class="perf-row"><span class="perf-label">Pociski / NPC</span><span class="perf-val"
      id="perfCounts">--</span></div>
  <div class="perf-row"><span class="perf-label">Wraki gorące / śpiące / zimne</span><span class="perf-val"
      id="perfWrecks">--</span></div>
  <div class="perf-row"><span class="perf-label">Enemy / Ally</span><span class="perf-val"
      id="perfNpcTeams">--</span></div>
  <div class="perf-row"><span class="perf-label">PointLighty</span><span class="perf-val"
      id="perfPointLights">--</span></div>
  <canvas id="perfGraph" width="240" height="44"></canvas>
  <div class="perf-sep"></div>
  <div class="perf-row"><strong style="color:#8fb5ff;font-size:10px;letter-spacing:.04em">RENDER</strong></div>
  <div style="display:flex;flex-wrap:wrap;gap:4px 8px;margin:4px 0;pointer-events:auto">
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleBloom" type="checkbox" style="margin:0"> Bloom</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleHeat" type="checkbox" style="margin:0"> Heat</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleBg" type="checkbox" style="margin:0"> BG</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleOrtho" type="checkbox" style="margin:0"> Ortho</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleFg" type="checkbox" style="margin:0"> FG</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleMsaa" type="checkbox" style="margin:0"> MSAA</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#9fb0d8;cursor:pointer"><input id="perfToggleEngineLights" type="checkbox" style="margin:0"> EngLight</label>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:4px 8px;margin:2px 0;pointer-events:auto">
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#7a9bbf;cursor:pointer"><input id="perfToggleFgBldg" type="checkbox" style="margin:0"> Bldg</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#7a9bbf;cursor:pointer"><input id="perfToggleFgStations" type="checkbox" style="margin:0"> Stacje</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#7a9bbf;cursor:pointer"><input id="perfToggleFgWeapons" type="checkbox" style="margin:0"> Bronie</label>
    <label style="display:flex;gap:3px;align-items:center;font-size:10px;color:#7a9bbf;cursor:pointer"><input id="perfToggleFgShadows" type="checkbox" style="margin:0"> Cienie</label>
  </div>
  <div class="perf-controls" style="grid-template-columns:repeat(3,1fr)">
    <button class="perf-btn" id="perfPresetBase" type="button">Base</button>
    <button class="perf-btn" id="perfPresetFast" type="button">Fast</button>
    <button class="perf-btn" id="perfPresetUltra" type="button" title="Najniższa jakość — wszystkie efekty OFF">UltraFast</button>
  </div>
  <div style="color:#556;font-size:9px;margin-top:2px;pointer-events:none" id="perfRenderStatus"></div>
</div>
`;

let worldSource = () => ({});

/**
 * Podaje panelowi zrodlo stanu swiata.
 * @param {() => ({ship?, npcs?, wrecks?, bullets?, physicsBridge?})} fn
 */
export function setPerfHudWorldSource(fn) {
  worldSource = typeof fn === 'function' ? fn : () => ({});
}

/** Wstrzykuje markup panelu do <body>, jesli jeszcze go nie ma. */
export function mountPerfHudDom(host = document.body) {
  if (document.getElementById('perfPanel')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = PERF_PANEL_HTML.trim();
  while (wrap.firstElementChild) host.appendChild(wrap.firstElementChild);
}

export const PerfHUD = {
  history: new Float32Array(120),
  percentileScratch: new Float32Array(120),
  histIdx: 0,
  visible: false,
  lastFlush: 0,
  updateInterval: 500,
    accum: {
      frameCount: 0,
      frameMs: 0,
      physicsTime: 0,
      destructorTime: 0,
      collisionTime: 0,
      deformTime: 0,
      aiTime: 0,
      aiSquadsTime: 0,
      aiSupportWingTime: 0,
      aiNpcStepTime: 0,
      aiNpcGridTime: 0,
      aiNpcEnemyBrainTime: 0,
      aiNpcFriendlyBrainTime: 0,
      aiNpcOtherTime: 0,
      aiPirateMissionTime: 0,
      aiSeparationTime: 0,
      aiWeaponScanTime: 0,
      aiTargetPickTime: 0,
      preAiTime: 0,
      projectileTime: 0,
      destructiblePrepTime: 0,
      hardpointTime: 0,
      hudNavTime: 0,
      worldZoneTime: 0,
      playerSystemsTime: 0,
      scanUiTime: 0,
      playerFlightTime: 0,
      wreckPrepTime: 0,
      ciwsTime: 0,
      bulletGridTime: 0,
      bulletMoveVfxTime: 0,
      bulletInterceptTime: 0,
      bulletNpcHitTime: 0,
      bulletAsteroidTime: 0,
      bulletRingTime: 0,
      bulletMiscHitTime: 0,
      npcFireTime: 0,
      npcFireScanTime: 0,
      npcFireSpawnTime: 0,
      drawTime: 0,
      renderPrepTime: 0,
      render3dUpdateTime: 0,
      render3dPlanetsUpdateTime: 0,
      render3dRingsUpdateTime: 0,
      render3dStationsUpdateTime: 0,
      render3dWorldUpdateTime: 0,
      render3dAsteroidsUpdateTime: 0,
      render3dDestructionUpdateTime: 0,
      render3dHexUpdateTime: 0,
      render3dShieldsUpdateTime: 0,
      render3dDrawTime: 0,
      render3dCoreCallTime: 0,
      render3dCoreRenderTime: 0,
      render3dComposerTime: 0,
      render3dBlitTime: 0,
      render2dWorldTime: 0,
      render2dNpcTime: 0,
      render2dPlayerTime: 0,
      render2dTurretTime: 0,
      render2dProjectilesTime: 0,
      render2dVfxTime: 0,
      renderHudTime: 0,
      renderUiTime: 0,
      planetsTime: 0,
    stationsTime: 0,
    world3dTime: 0,
    hex3dTime: 0,
    vfxUpdateTime: 0,
    overlayFxTime: 0,
    contacts: 0,
    physicsSteps: 0,
    aiDecisionTicks: 0
  },
  display: {
    fps: 0,
    frameMs: 0,
    frameP50: 0,
    frameP95: 0,
      frameUntrackedTime: 0,
      physicsTime: 0,
      physicsPerStep: 0,
      destructorTime: 0,
      collisionTime: 0,
      deformTime: 0,
      aiTime: 0,
      aiPerStep: 0,
      aiSquadsTime: 0,
      aiSquadsPerStep: 0,
      aiSupportWingTime: 0,
      aiSupportWingPerStep: 0,
      aiNpcStepTime: 0,
      aiNpcStepPerStep: 0,
      aiNpcGridTime: 0,
      aiNpcGridPerStep: 0,
      aiNpcEnemyBrainTime: 0,
      aiNpcEnemyBrainPerStep: 0,
      aiNpcFriendlyBrainTime: 0,
      aiNpcFriendlyBrainPerStep: 0,
      aiNpcOtherTime: 0,
      aiNpcOtherPerStep: 0,
      aiPirateMissionTime: 0,
      aiPirateMissionPerStep: 0,
      aiSeparationTime: 0,
      aiSeparationPerStep: 0,
      aiWeaponScanTime: 0,
      aiWeaponScanPerStep: 0,
      aiTargetPickTime: 0,
      aiTargetPickPerStep: 0,
      preAiTime: 0,
      preAiPerStep: 0,
      projectileTime: 0,
      projectilePerStep: 0,
      destructiblePrepTime: 0,
      destructiblePrepPerStep: 0,
      hardpointTime: 0,
      hardpointPerStep: 0,
      hudNavTime: 0,
      hudNavPerStep: 0,
      worldZoneTime: 0,
      worldZonePerStep: 0,
      playerSystemsTime: 0,
      playerSystemsPerStep: 0,
      scanUiTime: 0,
      scanUiPerStep: 0,
      playerFlightTime: 0,
      playerFlightPerStep: 0,
      wreckPrepTime: 0,
      wreckPrepPerStep: 0,
      ciwsTime: 0,
      ciwsPerStep: 0,
      bulletGridTime: 0,
      bulletGridPerStep: 0,
      bulletMoveVfxTime: 0,
      bulletMoveVfxPerStep: 0,
      bulletInterceptTime: 0,
      bulletInterceptPerStep: 0,
      bulletNpcHitTime: 0,
      bulletNpcHitPerStep: 0,
      bulletAsteroidTime: 0,
      bulletAsteroidPerStep: 0,
      bulletRingTime: 0,
      bulletRingPerStep: 0,
      bulletMiscHitTime: 0,
      bulletMiscHitPerStep: 0,
      npcFireTime: 0,
      npcFirePerStep: 0,
      npcFireScanTime: 0,
      npcFireScanPerStep: 0,
      npcFireSpawnTime: 0,
      npcFireSpawnPerStep: 0,
      drawTime: 0,
      renderPrepTime: 0,
      render3dUpdateTime: 0,
      render3dPlanetsUpdateTime: 0,
      render3dRingsUpdateTime: 0,
      render3dStationsUpdateTime: 0,
      render3dWorldUpdateTime: 0,
      render3dAsteroidsUpdateTime: 0,
      render3dDestructionUpdateTime: 0,
      render3dHexUpdateTime: 0,
      render3dShieldsUpdateTime: 0,
      render3dDrawTime: 0,
      render3dCoreCallTime: 0,
      render3dCoreRenderTime: 0,
      render3dComposerTime: 0,
      render3dBlitTime: 0,
      render2dWorldTime: 0,
      render2dNpcTime: 0,
      render2dPlayerTime: 0,
      render2dTurretTime: 0,
      render2dProjectilesTime: 0,
      render2dVfxTime: 0,
      renderHudTime: 0,
      renderUiTime: 0,
    planetsTime: 0,
    stationsTime: 0,
    world3dTime: 0,
    hex3dTime: 0,
    vfxUpdateTime: 0,
    overlayFxTime: 0,
    contacts: 0,
    physicsSteps: 0,
    aiDecisionHz: 0,
    entities: 0,
    shards: 0,
    bulletsCount: 0,
    npcCount: 0,
    hotWreckCount: 0,
    sleepingWreckCount: 0,
    coldWreckCount: 0,
    fighterCount: 0,
    enemyNpcCount: 0,
    friendlyNpcCount: 0,
    enemyFighterCount: 0,
    friendlyFighterCount: 0,
    pointLightCount: 0,
    visiblePointLightCount: 0,
    enginePointLightCount: 0,
    visibleEnginePointLightCount: 0
  },
  els: null,
  graphCtx: null,
  aiDecisionTargetHz: 0,
  physicsHz: 120,
  collapsedSections: { physics: true, ai: true, render: false, render3dDraw: false },
  _sectionToggleBound: false,
  sectionRows: {
    physics: [
      'perfDestructor', 'perfCollisions', 'perfDeform', 'perfAi',
      'perfPreAi', 'perfWorldZone', 'perfPlayerSystems', 'perfScanUi',
      'perfPlayerFlight', 'perfWreckPrep', 'perfProjectiles', 'perfCiws',
      'perfBulletGrid', 'perfBulletMoveVfx', 'perfBulletIntercept',
      'perfBulletNpcHit', 'perfBulletAsteroids', 'perfBulletRing',
      'perfBulletMiscHits', 'perfNpcFire', 'perfNpcFireScan',
      'perfNpcFireSpawn', 'perfDestructiblePrep',
      'perfHardpoints', 'perfHudNav'
    ],
    ai: [
      'perfAiSquads', 'perfAiSupportWing', 'perfAiNpcStep',
      'perfAiNpcGrid', 'perfAiNpcEnemyBrain', 'perfAiNpcFriendlyBrain',
      'perfAiNpcOther',
      'perfAiPirateMission', 'perfAiSeparation', 'perfAiWeaponScan',
      'perfAiTargetPick'
    ],
    render: [
      'perfRenderPrep', 'perfRender3dUpdate',
      'perfRender3dPlanetsUpdate', 'perfRender3dRingsUpdate',
      'perfRender3dStationsUpdate', 'perfRender3dWorldUpdate',
      'perfRender3dAsteroidsUpdate', 'perfRender3dDestructionUpdate',
      'perfRender3dHexUpdate', 'perfRender3dShieldsUpdate',
      'perfRender3dDraw',
      'perfRender2dWorld', 'perfRender2dNpc', 'perfRender2dPlayer',
      'perfRender2dProjectiles', 'perfRender2dVfx', 'perfRenderHud',
      'perfRenderUi', 'perfOverlayFx'
    ],
    render3dDraw: [
      'perfRender3dCoreCall', 'perfRender3dCoreRender',
      'perfRender3dComposer', 'perfRender3dBlit'
    ]
  },

  init() {
    const panel = document.getElementById('perfPanel');
    const graph = document.getElementById('perfGraph');
    if (panel) panel.classList.toggle('hidden', !this.visible);
    this.els = {
      panel,
      fps: document.getElementById('perfFps'),
      frameMs: document.getElementById('perfFrameTime'),
      framePercentiles: document.getElementById('perfFramePercentiles'),
      hexArena: document.getElementById('perfHexArena'),
      hexLod: document.getElementById('perfHexLod'),
      culling: document.getElementById('perfCulling'),
      physicsWorker: document.getElementById('perfPhysicsWorker'),
      aiCadence: document.getElementById('perfAiCadence'),
      frameUntracked: document.getElementById('perfFrameUntracked'),
      physics: document.getElementById('perfPhysics'),
      destructor: document.getElementById('perfDestructor'),
      collisions: document.getElementById('perfCollisions'),
      deform: document.getElementById('perfDeform'),
      ai: document.getElementById('perfAi'),
      aiSquads: document.getElementById('perfAiSquads'),
      aiSupportWing: document.getElementById('perfAiSupportWing'),
      aiNpcStep: document.getElementById('perfAiNpcStep'),
      aiNpcGrid: document.getElementById('perfAiNpcGrid'),
      aiNpcEnemyBrain: document.getElementById('perfAiNpcEnemyBrain'),
      aiNpcFriendlyBrain: document.getElementById('perfAiNpcFriendlyBrain'),
      aiNpcOther: document.getElementById('perfAiNpcOther'),
      aiPirateMission: document.getElementById('perfAiPirateMission'),
      aiSeparation: document.getElementById('perfAiSeparation'),
      aiWeaponScan: document.getElementById('perfAiWeaponScan'),
      aiTargetPick: document.getElementById('perfAiTargetPick'),
      preAi: document.getElementById('perfPreAi'),
      projectiles: document.getElementById('perfProjectiles'),
      destructiblePrep: document.getElementById('perfDestructiblePrep'),
      hardpoints: document.getElementById('perfHardpoints'),
      hudNav: document.getElementById('perfHudNav'),
      worldZone: document.getElementById('perfWorldZone'),
      playerSystems: document.getElementById('perfPlayerSystems'),
      scanUi: document.getElementById('perfScanUi'),
      playerFlight: document.getElementById('perfPlayerFlight'),
      wreckPrep: document.getElementById('perfWreckPrep'),
      ciws: document.getElementById('perfCiws'),
      bulletGrid: document.getElementById('perfBulletGrid'),
      bulletMoveVfx: document.getElementById('perfBulletMoveVfx'),
      bulletIntercept: document.getElementById('perfBulletIntercept'),
      bulletNpcHit: document.getElementById('perfBulletNpcHit'),
      bulletAsteroids: document.getElementById('perfBulletAsteroids'),
      bulletRing: document.getElementById('perfBulletRing'),
      bulletMiscHits: document.getElementById('perfBulletMiscHits'),
      npcFire: document.getElementById('perfNpcFire'),
      npcFireScan: document.getElementById('perfNpcFireScan'),
      npcFireSpawn: document.getElementById('perfNpcFireSpawn'),
      draw: document.getElementById('perfDraw'),
      renderPrep: document.getElementById('perfRenderPrep'),
      render3dUpdate: document.getElementById('perfRender3dUpdate'),
      render3dPlanetsUpdate: document.getElementById('perfRender3dPlanetsUpdate'),
      render3dRingsUpdate: document.getElementById('perfRender3dRingsUpdate'),
      render3dStationsUpdate: document.getElementById('perfRender3dStationsUpdate'),
      render3dWorldUpdate: document.getElementById('perfRender3dWorldUpdate'),
      render3dAsteroidsUpdate: document.getElementById('perfRender3dAsteroidsUpdate'),
      render3dDestructionUpdate: document.getElementById('perfRender3dDestructionUpdate'),
      render3dHexUpdate: document.getElementById('perfRender3dHexUpdate'),
      render3dShieldsUpdate: document.getElementById('perfRender3dShieldsUpdate'),
      render3dDraw: document.getElementById('perfRender3dDraw'),
      render3dCoreCall: document.getElementById('perfRender3dCoreCall'),
      render3dCoreRender: document.getElementById('perfRender3dCoreRender'),
      render3dComposer: document.getElementById('perfRender3dComposer'),
      render3dBlit: document.getElementById('perfRender3dBlit'),
      render2dWorld: document.getElementById('perfRender2dWorld'),
      render2dNpc: document.getElementById('perfRender2dNpc'),
      render2dPlayer: document.getElementById('perfRender2dPlayer'),
      render2dTurret: document.getElementById('perfRender2dTurret'),
      render2dProjectiles: document.getElementById('perfRender2dProjectiles'),
      render2dVfx: document.getElementById('perfRender2dVfx'),
      renderHud: document.getElementById('perfRenderHud'),
      renderUi: document.getElementById('perfRenderUi'),
      overlayFx: document.getElementById('perfOverlayFx'),
      shards: document.getElementById('perfShards'),
      contacts: document.getElementById('perfContacts'),
      gpuFrame: document.getElementById('perfGpuFrame'),
      sceneObjects: document.getElementById('perfSceneObjects'),
      drawCalls: document.getElementById('perfDrawCalls'),
      drawCallsRefraction: document.getElementById('perfDrawCallsRefraction'),
      drawCallsBg: document.getElementById('perfDrawCallsBg'),
      drawCallsPlanets: document.getElementById('perfDrawCallsPlanets'),
      drawCallsShafts: document.getElementById('perfDrawCallsShafts'),
      drawCallsOrtho: document.getElementById('perfDrawCallsOrtho'),
      drawCallsCategories: document.getElementById('perfDrawCallsCategories'),
      drawCallsImpostors: document.getElementById('perfDrawCallsImpostors'),
      drawCallsFg: document.getElementById('perfDrawCallsFg'),
      drawCallsBloom: document.getElementById('perfDrawCallsBloom'),
      drawCallsPost: document.getElementById('perfDrawCallsPost'),
      drawCallsOther: document.getElementById('perfDrawCallsOther'),
      counts: document.getElementById('perfCounts'),
      wrecks: document.getElementById('perfWrecks'),
      npcTeams: document.getElementById('perfNpcTeams'),
      pointLights: document.getElementById('perfPointLights'),
      barFrameUntracked: document.getElementById('barFrameUntracked'),
      barPhysics: document.getElementById('barPhysics'),
      barDestructor: document.getElementById('barDestructor'),
      barCollisions: document.getElementById('barCollisions'),
      barDeform: document.getElementById('barDeform'),
      barAi: document.getElementById('barAi'),
      barAiSquads: document.getElementById('barAiSquads'),
      barAiSupportWing: document.getElementById('barAiSupportWing'),
      barAiNpcStep: document.getElementById('barAiNpcStep'),
      barAiNpcGrid: document.getElementById('barAiNpcGrid'),
      barAiNpcEnemyBrain: document.getElementById('barAiNpcEnemyBrain'),
      barAiNpcFriendlyBrain: document.getElementById('barAiNpcFriendlyBrain'),
      barAiNpcOther: document.getElementById('barAiNpcOther'),
      barAiPirateMission: document.getElementById('barAiPirateMission'),
      barAiSeparation: document.getElementById('barAiSeparation'),
      barAiWeaponScan: document.getElementById('barAiWeaponScan'),
      barAiTargetPick: document.getElementById('barAiTargetPick'),
      barPreAi: document.getElementById('barPreAi'),
      barProjectiles: document.getElementById('barProjectiles'),
      barDestructiblePrep: document.getElementById('barDestructiblePrep'),
      barHardpoints: document.getElementById('barHardpoints'),
      barHudNav: document.getElementById('barHudNav'),
      barWorldZone: document.getElementById('barWorldZone'),
      barPlayerSystems: document.getElementById('barPlayerSystems'),
      barScanUi: document.getElementById('barScanUi'),
      barPlayerFlight: document.getElementById('barPlayerFlight'),
      barWreckPrep: document.getElementById('barWreckPrep'),
      barCiws: document.getElementById('barCiws'),
      barBulletGrid: document.getElementById('barBulletGrid'),
      barBulletMoveVfx: document.getElementById('barBulletMoveVfx'),
      barBulletIntercept: document.getElementById('barBulletIntercept'),
      barBulletNpcHit: document.getElementById('barBulletNpcHit'),
      barBulletAsteroids: document.getElementById('barBulletAsteroids'),
      barBulletRing: document.getElementById('barBulletRing'),
      barBulletMiscHits: document.getElementById('barBulletMiscHits'),
      barNpcFire: document.getElementById('barNpcFire'),
      barNpcFireScan: document.getElementById('barNpcFireScan'),
      barNpcFireSpawn: document.getElementById('barNpcFireSpawn'),
      barDraw: document.getElementById('barDraw'),
      barRenderPrep: document.getElementById('barRenderPrep'),
      barRender3dUpdate: document.getElementById('barRender3dUpdate'),
      barRender3dPlanetsUpdate: document.getElementById('barRender3dPlanetsUpdate'),
      barRender3dRingsUpdate: document.getElementById('barRender3dRingsUpdate'),
      barRender3dStationsUpdate: document.getElementById('barRender3dStationsUpdate'),
      barRender3dWorldUpdate: document.getElementById('barRender3dWorldUpdate'),
      barRender3dAsteroidsUpdate: document.getElementById('barRender3dAsteroidsUpdate'),
      barRender3dDestructionUpdate: document.getElementById('barRender3dDestructionUpdate'),
      barRender3dHexUpdate: document.getElementById('barRender3dHexUpdate'),
      barRender3dShieldsUpdate: document.getElementById('barRender3dShieldsUpdate'),
      barRender3dDraw: document.getElementById('barRender3dDraw'),
      barRender3dCoreCall: document.getElementById('barRender3dCoreCall'),
      barRender3dCoreRender: document.getElementById('barRender3dCoreRender'),
      barRender3dComposer: document.getElementById('barRender3dComposer'),
      barRender3dBlit: document.getElementById('barRender3dBlit'),
      barRender2dWorld: document.getElementById('barRender2dWorld'),
      barRender2dNpc: document.getElementById('barRender2dNpc'),
      barRender2dPlayer: document.getElementById('barRender2dPlayer'),
      barRender2dTurret: document.getElementById('barRender2dTurret'),
      barRender2dProjectiles: document.getElementById('barRender2dProjectiles'),
      barRender2dVfx: document.getElementById('barRender2dVfx'),
      barRenderHud: document.getElementById('barRenderHud'),
      barRenderUi: document.getElementById('barRenderUi'),
      barOverlayFx: document.getElementById('barOverlayFx'),
      colStart: document.getElementById('perfColStart'),
      colStop: document.getElementById('perfColStop'),
      renderStart: document.getElementById('perfRenderStart'),
      renderStop: document.getElementById('perfRenderStop'),
      aiStart: document.getElementById('perfAiStart'),
      aiStop: document.getElementById('perfAiStop'),
      toggleBloom: document.getElementById('perfToggleBloom'),
      toggleHeat: document.getElementById('perfToggleHeat'),
      toggleBg: document.getElementById('perfToggleBg'),
      toggleOrtho: document.getElementById('perfToggleOrtho'),
      toggleFg: document.getElementById('perfToggleFg'),
      toggleMsaa: document.getElementById('perfToggleMsaa'),
      toggleEngineLights: document.getElementById('perfToggleEngineLights'),
      toggleFgBldg: document.getElementById('perfToggleFgBldg'),
      toggleFgStations: document.getElementById('perfToggleFgStations'),
      toggleFgWeapons: document.getElementById('perfToggleFgWeapons'),
      toggleFgShadows: document.getElementById('perfToggleFgShadows'),
      presetBase: document.getElementById('perfPresetBase'),
      presetFast: document.getElementById('perfPresetFast'),
      presetUltra: document.getElementById('perfPresetUltra'),
      renderStatus: document.getElementById('perfRenderStatus')
    };
    this.graphCtx = graph ? graph.getContext('2d') : null;
    this.history.fill(16.67);
    this.loadCollapsedSections();
    this.lastFlush = performance.now();
    if (!this._debugButtonsBound) {
      const bind = (el, fn) => {
        if (!el) return;
        el.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          fn();
          this.refreshDebugButtons();
        });
      };
      bind(this.els.colStart, () => window.ColFuncDbgStart?.(1000));
      bind(this.els.colStop, () => window.ColFuncDbgStop?.());
      bind(this.els.renderStart, () => window.RenderDbgStart?.(1000));
      bind(this.els.renderStop, () => window.RenderDbgStop?.());
      bind(this.els.aiStart, () => window.AIFuncDbgStart?.(1000));
      bind(this.els.aiStop, () => window.AIFuncDbgStop?.());

      const applyRenderToggles = () => {
        if (typeof window.Core3DPerf === 'function') {
          window.Core3DPerf({
            bloom: !!this.els.toggleBloom?.checked,
            heatHaze: !!this.els.toggleHeat?.checked,
            bgPass: !!this.els.toggleBg?.checked,
            orthoPass: !!this.els.toggleOrtho?.checked,
            fgPass: !!this.els.toggleFg?.checked,
            enginePointLights: !!this.els.toggleEngineLights?.checked,
            fgBuildings: !!this.els.toggleFgBldg?.checked,
            fgStations: !!this.els.toggleFgStations?.checked,
            fgWeapons: !!this.els.toggleFgWeapons?.checked,
            fgShadows: !!this.els.toggleFgShadows?.checked
          });
        }
        if (typeof window.Core3DMsaa === 'function') {
          window.Core3DMsaa(!!this.els.toggleMsaa?.checked, 4);
        }
        this.syncRenderToggles();
      };
      [this.els.toggleBloom, this.els.toggleHeat, this.els.toggleBg, this.els.toggleOrtho, this.els.toggleFg, this.els.toggleMsaa,
       this.els.toggleEngineLights,
       this.els.toggleFgBldg, this.els.toggleFgStations, this.els.toggleFgWeapons, this.els.toggleFgShadows].forEach(el => {
        if (el) el.addEventListener('change', applyRenderToggles);
      });
      bind(this.els.presetBase, () => { if (typeof window.Core3DPreset === 'function') window.Core3DPreset('base'); this.syncRenderToggles(); });
      bind(this.els.presetFast, () => { if (typeof window.Core3DPreset === 'function') window.Core3DPreset('fast'); this.syncRenderToggles(); });
      bind(this.els.presetUltra, () => { if (typeof window.Core3DPreset === 'function') window.Core3DPreset('ultrafast'); this.syncRenderToggles(); });

      this._debugButtonsBound = true;
    }
    this.bindSectionToggles();
    this.applySectionCollapse();
    this.refreshDebugButtons();
    this.syncRenderToggles();
  },

  loadCollapsedSections() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('perfHudCollapsedSections');
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const key of Object.keys(this.collapsedSections)) {
        if (typeof saved?.[key] === 'boolean') this.collapsedSections[key] = saved[key];
      }
    } catch {}
  },

  saveCollapsedSections() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('perfHudCollapsedSections', JSON.stringify(this.collapsedSections));
    } catch {}
  },

  getPerfRowForValueId(id) {
    const el = document.getElementById(id);
    return el ? el.closest('.perf-row') : null;
  },

  setPerfMetricHidden(id, hidden) {
    const row = this.getPerfRowForValueId(id);
    if (!row) return;
    row.classList.toggle('perf-collapsed', !!hidden);
    const bar = row.nextElementSibling;
    if (bar?.classList?.contains('perf-bar-bg')) {
      bar.classList.toggle('perf-collapsed', !!hidden);
    }
  },

  setSectionRows(ids, hidden) {
    for (const id of ids) this.setPerfMetricHidden(id, hidden);
  },

  applySectionCollapse() {
    const physicsHidden = !!this.collapsedSections.physics;
    const renderHidden = !!this.collapsedSections.render;
    this.setSectionRows(this.sectionRows.physics, physicsHidden);
    this.setSectionRows(this.sectionRows.ai, physicsHidden || !!this.collapsedSections.ai);
    this.setSectionRows(this.sectionRows.render, renderHidden);
    this.setSectionRows(this.sectionRows.render3dDraw, renderHidden || !!this.collapsedSections.render3dDraw);

    const panel = this.els?.panel;
    for (const key of Object.keys(this.collapsedSections)) {
      const caret = panel?.querySelector(`[data-perf-caret="${key}"]`);
      if (caret) caret.textContent = this.collapsedSections[key] ? '+' : '-';
    }
  },

  toggleSection(key) {
    if (!(key in this.collapsedSections)) return;
    this.collapsedSections[key] = !this.collapsedSections[key];
    this.saveCollapsedSections();
    this.applySectionCollapse();
  },

  bindSectionToggles() {
    if (this._sectionToggleBound || !this.els?.panel) return;
    const toggles = this.els.panel.querySelectorAll('[data-perf-toggle]');
    for (const row of toggles) {
      const key = row.getAttribute('data-perf-toggle');
      const handler = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.toggleSection(key);
      };
      row.addEventListener('click', handler);
      row.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        handler(ev);
      });
    }
    this._sectionToggleBound = true;
  },

  toggle() {
    this.visible = !this.visible;
    if (this.els?.panel) {
      this.els.panel.classList.toggle('hidden', !this.visible);
    }
  },

  addTiming(key, ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (!(key in this.accum)) return;
    this.accum[key] += ms;
  },

  addContacts(count) {
    if (!Number.isFinite(count) || count < 0) return;
    this.accum.contacts += count;
  },

  markPhysicsStep() {
    this.accum.physicsSteps += 1;
  },

  setAiDecisionTargetHz(hz) {
    const value = Number(hz);
    this.aiDecisionTargetHz = Number.isFinite(value) && value > 0 ? value : 0;
  },

  // Krok fizyki (?physHz). Wiersz „Fizyka” dopisuje go, gdy nie jest domyślne 120.
  setPhysicsHz(hz) {
    const value = Number(hz);
    this.physicsHz = Number.isFinite(value) && value > 0 ? value : 120;
  },

  markAiDecisionTick() {
    this.accum.aiDecisionTicks += 1;
  },

  recordFrameTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.accum.frameCount += 1;
    this.accum.frameMs += ms;
    this.history[this.histIdx % this.history.length] = ms;
    this.histIdx += 1;
  },

  flush(now) {
    if (now - this.lastFlush < this.updateInterval) return;
    const flushSeconds = Math.max(0.001, (now - this.lastFlush) / 1000);
    const frames = Math.max(1, this.accum.frameCount);
    const avgFrame = this.accum.frameMs / frames;
    this.display.fps = Math.round(1000 / Math.max(0.001, avgFrame));
    this.display.frameMs = avgFrame;
    const percentileCount = Math.min(this.history.length, this.histIdx);
    for (let i = 0; i < percentileCount; i++) this.percentileScratch[i] = this.history[i];
    this.percentileScratch.subarray(0, percentileCount).sort();
    this.display.frameP50 = percentileCount > 0
      ? this.percentileScratch[Math.min(percentileCount - 1, Math.floor((percentileCount - 1) * 0.50))]
      : 0;
    this.display.frameP95 = percentileCount > 0
      ? this.percentileScratch[Math.min(percentileCount - 1, Math.ceil((percentileCount - 1) * 0.95))]
      : 0;
    this.display.physicsTime = this.accum.physicsTime / frames;
    this.display.physicsPerStep = this.accum.physicsTime / Math.max(1, this.accum.physicsSteps);
    this.display.destructorTime = this.accum.destructorTime / frames;
    this.display.collisionTime = this.accum.collisionTime / frames;
    this.display.deformTime = this.accum.deformTime / frames;
    this.display.aiTime = this.accum.aiTime / frames;
    this.display.aiPerStep = this.accum.aiTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiSquadsTime = this.accum.aiSquadsTime / frames;
    this.display.aiSquadsPerStep = this.accum.aiSquadsTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiSupportWingTime = this.accum.aiSupportWingTime / frames;
    this.display.aiSupportWingPerStep = this.accum.aiSupportWingTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiNpcStepTime = this.accum.aiNpcStepTime / frames;
    this.display.aiNpcStepPerStep = this.accum.aiNpcStepTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiNpcGridTime = this.accum.aiNpcGridTime / frames;
    this.display.aiNpcGridPerStep = this.accum.aiNpcGridTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiNpcEnemyBrainTime = this.accum.aiNpcEnemyBrainTime / frames;
    this.display.aiNpcEnemyBrainPerStep = this.accum.aiNpcEnemyBrainTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiNpcFriendlyBrainTime = this.accum.aiNpcFriendlyBrainTime / frames;
    this.display.aiNpcFriendlyBrainPerStep = this.accum.aiNpcFriendlyBrainTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiNpcOtherTime = this.accum.aiNpcOtherTime / frames;
    this.display.aiNpcOtherPerStep = this.accum.aiNpcOtherTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiPirateMissionTime = this.accum.aiPirateMissionTime / frames;
    this.display.aiPirateMissionPerStep = this.accum.aiPirateMissionTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiSeparationTime = this.accum.aiSeparationTime / frames;
    this.display.aiSeparationPerStep = this.accum.aiSeparationTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiWeaponScanTime = this.accum.aiWeaponScanTime / frames;
    this.display.aiWeaponScanPerStep = this.accum.aiWeaponScanTime / Math.max(1, this.accum.physicsSteps);
    this.display.aiTargetPickTime = this.accum.aiTargetPickTime / frames;
    this.display.aiTargetPickPerStep = this.accum.aiTargetPickTime / Math.max(1, this.accum.physicsSteps);
    this.display.preAiTime = this.accum.preAiTime / frames;
    this.display.preAiPerStep = this.accum.preAiTime / Math.max(1, this.accum.physicsSteps);
    this.display.projectileTime = this.accum.projectileTime / frames;
    this.display.projectilePerStep = this.accum.projectileTime / Math.max(1, this.accum.physicsSteps);
    this.display.destructiblePrepTime = this.accum.destructiblePrepTime / frames;
    this.display.destructiblePrepPerStep = this.accum.destructiblePrepTime / Math.max(1, this.accum.physicsSteps);
    this.display.hardpointTime = this.accum.hardpointTime / frames;
    this.display.hardpointPerStep = this.accum.hardpointTime / Math.max(1, this.accum.physicsSteps);
    this.display.hudNavTime = this.accum.hudNavTime / frames;
    this.display.hudNavPerStep = this.accum.hudNavTime / Math.max(1, this.accum.physicsSteps);
    this.display.worldZoneTime = this.accum.worldZoneTime / frames;
    this.display.worldZonePerStep = this.accum.worldZoneTime / Math.max(1, this.accum.physicsSteps);
    this.display.playerSystemsTime = this.accum.playerSystemsTime / frames;
    this.display.playerSystemsPerStep = this.accum.playerSystemsTime / Math.max(1, this.accum.physicsSteps);
    this.display.scanUiTime = this.accum.scanUiTime / frames;
    this.display.scanUiPerStep = this.accum.scanUiTime / Math.max(1, this.accum.physicsSteps);
    this.display.playerFlightTime = this.accum.playerFlightTime / frames;
    this.display.playerFlightPerStep = this.accum.playerFlightTime / Math.max(1, this.accum.physicsSteps);
    this.display.wreckPrepTime = this.accum.wreckPrepTime / frames;
    this.display.wreckPrepPerStep = this.accum.wreckPrepTime / Math.max(1, this.accum.physicsSteps);
    this.display.ciwsTime = this.accum.ciwsTime / frames;
    this.display.ciwsPerStep = this.accum.ciwsTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletGridTime = this.accum.bulletGridTime / frames;
    this.display.bulletGridPerStep = this.accum.bulletGridTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletMoveVfxTime = this.accum.bulletMoveVfxTime / frames;
    this.display.bulletMoveVfxPerStep = this.accum.bulletMoveVfxTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletInterceptTime = this.accum.bulletInterceptTime / frames;
    this.display.bulletInterceptPerStep = this.accum.bulletInterceptTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletNpcHitTime = this.accum.bulletNpcHitTime / frames;
    this.display.bulletNpcHitPerStep = this.accum.bulletNpcHitTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletAsteroidTime = this.accum.bulletAsteroidTime / frames;
    this.display.bulletAsteroidPerStep = this.accum.bulletAsteroidTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletRingTime = this.accum.bulletRingTime / frames;
    this.display.bulletRingPerStep = this.accum.bulletRingTime / Math.max(1, this.accum.physicsSteps);
    this.display.bulletMiscHitTime = this.accum.bulletMiscHitTime / frames;
    this.display.bulletMiscHitPerStep = this.accum.bulletMiscHitTime / Math.max(1, this.accum.physicsSteps);
    this.display.npcFireTime = this.accum.npcFireTime / frames;
    this.display.npcFirePerStep = this.accum.npcFireTime / Math.max(1, this.accum.physicsSteps);
    this.display.npcFireScanTime = this.accum.npcFireScanTime / frames;
    this.display.npcFireScanPerStep = this.accum.npcFireScanTime / Math.max(1, this.accum.physicsSteps);
    this.display.npcFireSpawnTime = this.accum.npcFireSpawnTime / frames;
    this.display.npcFireSpawnPerStep = this.accum.npcFireSpawnTime / Math.max(1, this.accum.physicsSteps);
    this.display.drawTime = this.accum.drawTime / frames;
    // Untracked = klatka minus WSZYSTKIE mierzone buckety najwyższego poziomu
    // (fizyka, rysowanie, deformacje destruktora, CanvasVFX update, overlay FX 3D).
    this.display.frameUntrackedTime = Math.max(0, this.display.frameMs
      - this.display.physicsTime
      - this.display.drawTime
      - this.display.deformTime
      - this.display.vfxUpdateTime
      - this.display.overlayFxTime);
    this.display.renderPrepTime = this.accum.renderPrepTime / frames;
    this.display.render3dUpdateTime = this.accum.render3dUpdateTime / frames;
    this.display.render3dPlanetsUpdateTime = this.accum.render3dPlanetsUpdateTime / frames;
    this.display.render3dRingsUpdateTime = this.accum.render3dRingsUpdateTime / frames;
    this.display.render3dStationsUpdateTime = this.accum.render3dStationsUpdateTime / frames;
    this.display.render3dWorldUpdateTime = this.accum.render3dWorldUpdateTime / frames;
    this.display.render3dAsteroidsUpdateTime = this.accum.render3dAsteroidsUpdateTime / frames;
    this.display.render3dDestructionUpdateTime = this.accum.render3dDestructionUpdateTime / frames;
    this.display.render3dHexUpdateTime = this.accum.render3dHexUpdateTime / frames;
    this.display.render3dShieldsUpdateTime = this.accum.render3dShieldsUpdateTime / frames;
    this.display.render3dDrawTime = this.accum.render3dDrawTime / frames;
    this.display.render3dCoreCallTime = this.accum.render3dCoreCallTime / frames;
    this.display.render3dCoreRenderTime = this.accum.render3dCoreRenderTime / frames;
    this.display.render3dComposerTime = this.accum.render3dComposerTime / frames;
    this.display.render3dBlitTime = this.accum.render3dBlitTime / frames;
    this.display.render2dWorldTime = this.accum.render2dWorldTime / frames;
    this.display.render2dNpcTime = this.accum.render2dNpcTime / frames;
    this.display.render2dPlayerTime = this.accum.render2dPlayerTime / frames;
    this.display.render2dTurretTime = this.accum.render2dTurretTime / frames;
    this.display.render2dProjectilesTime = this.accum.render2dProjectilesTime / frames;
    this.display.render2dVfxTime = this.accum.render2dVfxTime / frames;
    this.display.renderHudTime = this.accum.renderHudTime / frames;
    this.display.renderUiTime = this.accum.renderUiTime / frames;
    this.display.planetsTime = this.accum.planetsTime / frames;
    this.display.stationsTime = this.accum.stationsTime / frames;
    this.display.world3dTime = this.accum.world3dTime / frames;
    this.display.hex3dTime = this.accum.hex3dTime / frames;
    this.display.vfxUpdateTime = this.accum.vfxUpdateTime / frames;
    this.display.overlayFxTime = this.accum.overlayFxTime / frames;
    this.display.contacts = this.accum.contacts / frames;
    this.display.physicsSteps = this.accum.physicsSteps / frames;
    this.display.aiDecisionHz = this.accum.aiDecisionTicks / flushSeconds;

    const counts = this.collectCounts();
    this.display.entities = counts.entities;
    this.display.shards = counts.shards;
    this.display.sleepingShards = counts.sleepingShards;
    this.display.bulletsCount = counts.bulletsCount;
    this.display.npcCount = counts.npcCount;
    this.display.hotWreckCount = counts.hotWreckCount;
    this.display.sleepingWreckCount = counts.sleepingWreckCount;
    this.display.coldWreckCount = counts.coldWreckCount;
    this.display.fighterCount = counts.fighterCount;
    this.display.enemyNpcCount = counts.enemyNpcCount;
    this.display.friendlyNpcCount = counts.friendlyNpcCount;
    this.display.enemyFighterCount = counts.enemyFighterCount;
    this.display.friendlyFighterCount = counts.friendlyFighterCount;
    this.display.pointLightCount = counts.pointLightCount;
    this.display.visiblePointLightCount = counts.visiblePointLightCount;
    this.display.enginePointLightCount = counts.enginePointLightCount;
    this.display.visibleEnginePointLightCount = counts.visibleEnginePointLightCount;

    this.updateDOM();
    this.syncRenderToggles();
    this.drawGraph();
    this.resetAccum();
    this.lastFlush = now;
  },

  collectCounts() {
    const { ship = null, npcs = [], wrecks = [], coldWrecks = [], bullets = [] } = worldSource() || {};
    let entitiesCount = 0;
    let activeShards = 0;
    let sleepingShards = 0;
    let hotWreckCount = 0;
    let sleepingWreckCount = 0;
    const all = [];
    if (ship && ship.hexGrid && !ship.dead) all.push(ship);
    for (const npc of npcs) {
      if (npc && npc.hexGrid && !npc.dead) all.push(npc);
    }
    for (const w of wrecks) {
      if (!w || w.dead) continue;
      if (w._wreckSleeping) sleepingWreckCount++;
      else hotWreckCount++;
      if (w.hexGrid) all.push(w);
    }
    entitiesCount = all.length;
    for (const e of all) {
      const shards = e?.hexGrid?.shards;
      if (!Array.isArray(shards)) continue;
      const isSleeping = e.isWreck && e._wreckSleeping;
      for (let i = 0; i < shards.length; i++) {
        const s = shards[i];
        if (!s?.active || s.isDebris) continue;
        if (isSleeping) sleepingShards++;
        else activeShards++;
      }
    }
    let npcCount = 0;
    let fighterCount = 0;
    let enemyNpcCount = 0;
    let friendlyNpcCount = 0;
    let enemyFighterCount = 0;
    let friendlyFighterCount = 0;
    for (const npc of npcs) {
      if (!npc || npc.dead) continue;
      const isFighter = !!(npc.fighter || npc.type === 'fighter');
      npcCount++;
      if (isFighter) fighterCount++;
      if (npc.friendly) {
        friendlyNpcCount++;
        if (isFighter) friendlyFighterCount++;
      } else {
        enemyNpcCount++;
        if (isFighter) enemyFighterCount++;
      }
    }
    let pointLightCount = 0;
    let visiblePointLightCount = 0;
    let enginePointLightCount = 0;
    let visibleEnginePointLightCount = 0;
    const scene = window.Core3D?.scene;
    if (scene?.traverse) {
      scene.traverse((obj) => {
        if (!obj?.isPointLight) return;
        pointLightCount++;
        if (obj.visible !== false) visiblePointLightCount++;
        if (obj.userData?.enginePointLight) {
          enginePointLightCount++;
          if (obj.visible !== false) visibleEnginePointLightCount++;
        }
      });
    }
    return {
      entities: entitiesCount,
      shards: activeShards,
      sleepingShards,
      bulletsCount: Array.isArray(bullets) ? bullets.length : 0,
      npcCount,
      hotWreckCount,
      sleepingWreckCount,
      // Zimne (src/game/coldWrecks.js): poza wszystkimi listami, tylko smuga.
      coldWreckCount: Array.isArray(coldWrecks) ? coldWrecks.length : 0,
      fighterCount,
      enemyNpcCount,
      friendlyNpcCount,
      enemyFighterCount,
      friendlyFighterCount,
      pointLightCount,
      visiblePointLightCount,
      enginePointLightCount,
      visibleEnginePointLightCount
    };
  },

  updateDOM() {
    if (!this.visible || !this.els) return;
    this.refreshDebugButtons();
    const e = this.els;
    const d = this.display;
    const setMs = (el, value) => { if (el) el.textContent = `${value.toFixed(2)} ms`; };
    const setMsWithStep = (el, frameValue, stepValue) => {
      if (!el) return;
      el.textContent = `${frameValue.toFixed(2)} ms | ${stepValue.toFixed(2)}/step`;
    };
    const setBar = (el, valueMs) => {
      if (!el) return;
      const width = Math.min(100, (valueMs / 16.67) * 100);
      el.style.width = `${Math.max(0, width).toFixed(0)}%`;
    };
    const formatDrawInfo = (bucket) => {
      if (!bucket) return '--';
      const calls = Math.round(Number(bucket.calls) || 0);
      const triangles = Math.round(Number(bucket.triangles) || 0);
      const triText = triangles >= 10000 ? `${Math.round(triangles / 1000)}k` : `${triangles}`;
      // Czas passa obok jego draw calli — pass rysujący 2 obiekty i pass
      // rysujący 300 mają ten sam koszt przejścia po grafie sceny, więc bez
      // ms nie da się odróżnić kosztu GPU od kosztu trawersu w CPU.
      const ms = Number(bucket.ms);
      const msText = Number.isFinite(ms) && ms > 0 ? ` · ${ms.toFixed(2)}ms` : '';
      return `${calls} / ${triText}${msText}`;
    };

    if (e.fps) {
      e.fps.textContent = `${d.fps}`;
      e.fps.className = `perf-fps ${d.fps >= 55 ? 'good' : d.fps >= 30 ? 'ok' : 'bad'}`;
    }
    if (e.frameMs) e.frameMs.textContent = `${d.frameMs.toFixed(1)} ms/frame`;
    if (e.framePercentiles) e.framePercentiles.textContent = `${d.frameP50.toFixed(1)} / ${d.frameP95.toFixed(1)} ms`;
    if (e.hexArena) {
      const arenaStats = getHexArenaStats();
      const arenaFill = arenaStats.capacity > 0 ? (arenaStats.allocated / arenaStats.capacity) : 0;
      const arenaOver = arenaStats.overflowBodies | 0;
      // Zapelnienie areny to ukryty klif wydajnosci, nie ciekawostka: po
      // przepelnieniu narrowphase cicho przechodzi na iteracje po wszystkich
      // heksach zamiast po brzegowych. Musi krzyczec ZANIM to nastapi.
      e.hexArena.textContent =
        `${arenaStats.allocated}/${arenaStats.capacity} (${(arenaFill * 100).toFixed(0)}%) | ${(arenaStats.bytes / 1048576).toFixed(1)} MB${arenaStats.shared ? ' SAB' : ''}` +
        (arenaOver > 0 ? ` | PRZEPELNIENIE x${arenaOver}` : '');
      e.hexArena.style.color = (arenaOver > 0 || arenaFill >= 0.95) ? '#f44'
        : (arenaFill >= 0.8 ? '#fd4' : '');
    }
    if (e.hexLod) {
      const lod = window.__hexLodStats;
      e.hexLod.textContent = lod
        ? `${lod.fullBodies}/${lod.hybridBodies}/${lod.impostorBodies} | ${lod.fullHexes + lod.hybridHexes}/${lod.totalStructuralHexes}`
        : '--';
    }
    if (e.culling) {
      // Odpowiedz na „czy odwrocenie kamery cokolwiek zdejmuje". Pierwsza liczba
      // to encje, ktore przeszly pudlo widoku i dostaly pelna prace per-mesh;
      // druga to odrzucone. Jesli przy odwroconej kamerze odrzutow jest ~0,
      // pudlo jest za duze (OVERSCAN) albo bitwa dalej w nim siedzi.
      // W nawiasie kandydaci na okludery shadow-shafts — ta petla ma WLASNY
      // zasieg (halfView + 30k) i kamera jej nie zmniejsza.
      const lod = window.__hexLodStats;
      if (lod) {
        const drawn = Math.max(0, (lod.entitiesIn | 0) - (lod.culled | 0));
        e.culling.textContent = `${drawn}/${lod.culled | 0} z ${lod.entitiesIn | 0} (${lod.shaftCands | 0})`;
        e.culling.style.color = (lod.entitiesIn > 40 && lod.culled === 0) ? '#fd4' : '';
      } else {
        e.culling.textContent = '--';
      }
    }
    if (e.physicsWorker) {
      const workerStats = worldSource()?.physicsBridge?.getStats?.();
      e.physicsWorker.textContent = workerStats
        ? `${workerStats.mode} q=${workerStats.commandBacklog}/${workerStats.aiCommandBacklog}/${workerStats.eventBacklog} drop=${workerStats.commandDropped + workerStats.aiCommandDropped + workerStats.eventDropped}`
        : 'disabled';
    }
    if (e.aiCadence) {
      e.aiCadence.textContent = `${d.aiDecisionHz.toFixed(1)} / ${this.aiDecisionTargetHz.toFixed(0)} Hz`;
    }

    setMs(e.frameUntracked, d.frameUntrackedTime);
    setMsWithStep(e.physics, d.physicsTime, d.physicsPerStep);
    if (e.physics && this.physicsHz !== 120) e.physics.textContent += ` @${this.physicsHz}Hz`;
    setMs(e.destructor, d.destructorTime);
    setMs(e.collisions, d.collisionTime);
    setMs(e.deform, d.deformTime);
    setMsWithStep(e.ai, d.aiTime, d.aiPerStep);
    setMsWithStep(e.aiSquads, d.aiSquadsTime, d.aiSquadsPerStep);
    setMsWithStep(e.aiSupportWing, d.aiSupportWingTime, d.aiSupportWingPerStep);
    setMsWithStep(e.aiNpcStep, d.aiNpcStepTime, d.aiNpcStepPerStep);
    setMsWithStep(e.aiNpcGrid, d.aiNpcGridTime, d.aiNpcGridPerStep);
    setMsWithStep(e.aiNpcEnemyBrain, d.aiNpcEnemyBrainTime, d.aiNpcEnemyBrainPerStep);
    setMsWithStep(e.aiNpcFriendlyBrain, d.aiNpcFriendlyBrainTime, d.aiNpcFriendlyBrainPerStep);
    setMsWithStep(e.aiNpcOther, d.aiNpcOtherTime, d.aiNpcOtherPerStep);
    setMsWithStep(e.aiPirateMission, d.aiPirateMissionTime, d.aiPirateMissionPerStep);
    setMsWithStep(e.aiSeparation, d.aiSeparationTime, d.aiSeparationPerStep);
    setMsWithStep(e.aiWeaponScan, d.aiWeaponScanTime, d.aiWeaponScanPerStep);
    setMsWithStep(e.aiTargetPick, d.aiTargetPickTime, d.aiTargetPickPerStep);
    setMsWithStep(e.preAi, d.preAiTime, d.preAiPerStep);
    setMsWithStep(e.worldZone, d.worldZoneTime, d.worldZonePerStep);
    setMsWithStep(e.playerSystems, d.playerSystemsTime, d.playerSystemsPerStep);
    setMsWithStep(e.scanUi, d.scanUiTime, d.scanUiPerStep);
    setMsWithStep(e.playerFlight, d.playerFlightTime, d.playerFlightPerStep);
    setMsWithStep(e.wreckPrep, d.wreckPrepTime, d.wreckPrepPerStep);
    setMsWithStep(e.projectiles, d.projectileTime, d.projectilePerStep);
    setMsWithStep(e.ciws, d.ciwsTime, d.ciwsPerStep);
    setMsWithStep(e.bulletGrid, d.bulletGridTime, d.bulletGridPerStep);
    setMsWithStep(e.bulletMoveVfx, d.bulletMoveVfxTime, d.bulletMoveVfxPerStep);
    setMsWithStep(e.bulletIntercept, d.bulletInterceptTime, d.bulletInterceptPerStep);
    setMsWithStep(e.bulletNpcHit, d.bulletNpcHitTime, d.bulletNpcHitPerStep);
    setMsWithStep(e.bulletAsteroids, d.bulletAsteroidTime, d.bulletAsteroidPerStep);
    setMsWithStep(e.bulletRing, d.bulletRingTime, d.bulletRingPerStep);
    setMsWithStep(e.bulletMiscHits, d.bulletMiscHitTime, d.bulletMiscHitPerStep);
    setMsWithStep(e.npcFire, d.npcFireTime, d.npcFirePerStep);
    setMsWithStep(e.npcFireScan, d.npcFireScanTime, d.npcFireScanPerStep);
    setMsWithStep(e.npcFireSpawn, d.npcFireSpawnTime, d.npcFireSpawnPerStep);
    setMsWithStep(e.destructiblePrep, d.destructiblePrepTime, d.destructiblePrepPerStep);
    setMsWithStep(e.hardpoints, d.hardpointTime, d.hardpointPerStep);
    setMsWithStep(e.hudNav, d.hudNavTime, d.hudNavPerStep);
    setMs(e.draw, d.drawTime);
    setMs(e.renderPrep, d.renderPrepTime);
    setMs(e.render3dUpdate, d.render3dUpdateTime);
    setMs(e.render3dPlanetsUpdate, d.render3dPlanetsUpdateTime);
    setMs(e.render3dRingsUpdate, d.render3dRingsUpdateTime);
    setMs(e.render3dStationsUpdate, d.render3dStationsUpdateTime);
    setMs(e.render3dWorldUpdate, d.render3dWorldUpdateTime);
    setMs(e.render3dAsteroidsUpdate, d.render3dAsteroidsUpdateTime);
    setMs(e.render3dDestructionUpdate, d.render3dDestructionUpdateTime);
    setMs(e.render3dHexUpdate, d.render3dHexUpdateTime);
    setMs(e.render3dShieldsUpdate, d.render3dShieldsUpdateTime);
    setMs(e.render3dDraw, d.render3dDrawTime);
    setMs(e.render3dCoreCall, d.render3dCoreCallTime);
    setMs(e.render3dCoreRender, d.render3dCoreRenderTime);
    setMs(e.render3dComposer, d.render3dComposerTime);
    setMs(e.render3dBlit, d.render3dBlitTime);
    setMs(e.render2dWorld, d.render2dWorldTime);
    setMs(e.render2dNpc, d.render2dNpcTime);
    setMs(e.render2dPlayer, d.render2dPlayerTime);
    setMs(e.render2dTurret, d.render2dTurretTime);
    setMs(e.render2dProjectiles, d.render2dProjectilesTime);
    setMs(e.render2dVfx, d.render2dVfxTime);
    setMs(e.renderHud, d.renderHudTime);
    setMs(e.renderUi, d.renderUiTime);
    setMs(e.overlayFx, d.overlayFxTime);
    setBar(e.barFrameUntracked, d.frameUntrackedTime);
    setBar(e.barPhysics, d.physicsTime);
    setBar(e.barDestructor, d.destructorTime);
    setBar(e.barCollisions, d.collisionTime);
    setBar(e.barDeform, d.deformTime);
    setBar(e.barAi, d.aiTime);
    setBar(e.barAiSquads, d.aiSquadsTime);
    setBar(e.barAiSupportWing, d.aiSupportWingTime);
    setBar(e.barAiNpcStep, d.aiNpcStepTime);
    setBar(e.barAiNpcGrid, d.aiNpcGridTime);
    setBar(e.barAiNpcEnemyBrain, d.aiNpcEnemyBrainTime);
    setBar(e.barAiNpcFriendlyBrain, d.aiNpcFriendlyBrainTime);
    setBar(e.barAiNpcOther, d.aiNpcOtherTime);
    setBar(e.barAiPirateMission, d.aiPirateMissionTime);
    setBar(e.barAiSeparation, d.aiSeparationTime);
    setBar(e.barAiWeaponScan, d.aiWeaponScanTime);
    setBar(e.barAiTargetPick, d.aiTargetPickTime);
    setBar(e.barPreAi, d.preAiTime);
    setBar(e.barWorldZone, d.worldZoneTime);
    setBar(e.barPlayerSystems, d.playerSystemsTime);
    setBar(e.barScanUi, d.scanUiTime);
    setBar(e.barPlayerFlight, d.playerFlightTime);
    setBar(e.barWreckPrep, d.wreckPrepTime);
    setBar(e.barProjectiles, d.projectileTime);
    setBar(e.barCiws, d.ciwsTime);
    setBar(e.barBulletGrid, d.bulletGridTime);
    setBar(e.barBulletMoveVfx, d.bulletMoveVfxTime);
    setBar(e.barBulletIntercept, d.bulletInterceptTime);
    setBar(e.barBulletNpcHit, d.bulletNpcHitTime);
    setBar(e.barBulletAsteroids, d.bulletAsteroidTime);
    setBar(e.barBulletRing, d.bulletRingTime);
    setBar(e.barBulletMiscHits, d.bulletMiscHitTime);
    setBar(e.barNpcFire, d.npcFireTime);
    setBar(e.barNpcFireScan, d.npcFireScanTime);
    setBar(e.barNpcFireSpawn, d.npcFireSpawnTime);
    setBar(e.barDestructiblePrep, d.destructiblePrepTime);
    setBar(e.barHardpoints, d.hardpointTime);
    setBar(e.barHudNav, d.hudNavTime);
    setBar(e.barDraw, d.drawTime);
    setBar(e.barRenderPrep, d.renderPrepTime);
    setBar(e.barRender3dUpdate, d.render3dUpdateTime);
    setBar(e.barRender3dPlanetsUpdate, d.render3dPlanetsUpdateTime);
    setBar(e.barRender3dRingsUpdate, d.render3dRingsUpdateTime);
    setBar(e.barRender3dStationsUpdate, d.render3dStationsUpdateTime);
    setBar(e.barRender3dWorldUpdate, d.render3dWorldUpdateTime);
    setBar(e.barRender3dAsteroidsUpdate, d.render3dAsteroidsUpdateTime);
    setBar(e.barRender3dDestructionUpdate, d.render3dDestructionUpdateTime);
    setBar(e.barRender3dHexUpdate, d.render3dHexUpdateTime);
    setBar(e.barRender3dShieldsUpdate, d.render3dShieldsUpdateTime);
    setBar(e.barRender3dDraw, d.render3dDrawTime);
    setBar(e.barRender3dCoreCall, d.render3dCoreCallTime);
    setBar(e.barRender3dCoreRender, d.render3dCoreRenderTime);
    setBar(e.barRender3dComposer, d.render3dComposerTime);
    setBar(e.barRender3dBlit, d.render3dBlitTime);
    setBar(e.barRender2dWorld, d.render2dWorldTime);
    setBar(e.barRender2dNpc, d.render2dNpcTime);
    setBar(e.barRender2dPlayer, d.render2dPlayerTime);
    setBar(e.barRender2dTurret, d.render2dTurretTime);
    setBar(e.barRender2dProjectiles, d.render2dProjectilesTime);
    setBar(e.barRender2dVfx, d.render2dVfxTime);
    setBar(e.barRenderHud, d.renderHudTime);
    setBar(e.barRenderUi, d.renderUiTime);
    setBar(e.barOverlayFx, d.overlayFxTime);
    if (e.shards) e.shards.textContent = d.sleepingShards > 0 ? `${d.shards} (${d.sleepingShards} zz)` : `${d.shards}`;
    if (e.contacts) e.contacts.textContent = `${Math.round(d.contacts)}`;
    if (e.drawCalls) {
      const ri = window.__rendererInfo;
      e.drawCalls.textContent = ri ? formatDrawInfo(ri) : '--';
      const passes = ri ? ri.passes : null;
      if (e.drawCallsRefraction) e.drawCallsRefraction.textContent = formatDrawInfo(passes?.refraction);
      if (e.drawCallsBg) e.drawCallsBg.textContent = formatDrawInfo(passes?.bg);
      if (e.drawCallsPlanets) e.drawCallsPlanets.textContent = formatDrawInfo(passes?.planets);
      if (e.drawCallsShafts) e.drawCallsShafts.textContent = formatDrawInfo(passes?.shafts);
      if (e.sceneObjects) {
        // Kazdy `renderer.render(scene, …)` wola `scene.updateMatrixWorld()`, ktore
        // przechodzi WSZYSTKIE dzieci — takze niewidoczne. W klatce jest ~8 takich
        // wywolan, wiec obiekty zostawione w scenie "bo sa ukryte" kosztuja realnie,
        // przy zerowej liczbie draw calli. Ta liczba ma byc plaska w czasie.
        const scene = window.Core3D?.scene;
        if (scene) {
          let total = 0;
          let hidden = 0;
          scene.traverse((o) => { total++; if (o.visible === false) hidden++; });
          e.sceneObjects.textContent = `${total} (${hidden} ukrytych)`;
          e.sceneObjects.style.color = hidden > total * 0.35 ? '#fd4' : '';
        } else {
          e.sceneObjects.textContent = '--';
        }
      }
      if (e.gpuFrame) {
        // Czas GPU z EXT_disjoint_timer_query_webgl2. Jesli ta liczba dobija do
        // czasu klatki, waskim gardlem jest karta i ciecie draw calli nic nie da.
        const gpuMs = Number(window.Core3D?.gpuFrameMs);
        if (!Number.isFinite(gpuMs) || gpuMs <= 0) {
          e.gpuFrame.textContent = window.Core3D?._gpuTimerExt ? 'czekam...' : 'brak ext';
          e.gpuFrame.style.color = '';
        } else {
          const frameMs = Number(d.frameP50) || 0;
          e.gpuFrame.textContent = `${gpuMs.toFixed(2)} ms`;
          e.gpuFrame.style.color = (frameMs > 0 && gpuMs > frameMs * 0.8) ? '#f44'
            : (frameMs > 0 && gpuMs > frameMs * 0.5) ? '#fd4' : '';
        }
      }
      if (e.drawCallsOrtho) e.drawCallsOrtho.textContent = formatDrawInfo(passes?.ortho);
      if (e.drawCallsCategories) {
        // Rozbicie passa Ortho na to, co faktycznie da sie zbatchowac. Suma nie
        // musi rownac sie licznikowi Ortho — poza tymi czterema kategoriami
        // siedza tam jeszcze asteroidy, tarcze i pule czastek.
        const cat = window.__drawCallStats;
        e.drawCallsCategories.textContent = cat
          ? `${cat.engineDraws} (${cat.engineNozzles} dysz) / ${cat.shipDraws} / ${cat.wreckDraws} / ${cat.weaponDraws} (${cat.turret2DCount} wiez 2D)`
          : '--';
      }
      if (e.drawCallsImpostors) {
        const cat = window.__drawCallStats;
        e.drawCallsImpostors.textContent = cat ? `${cat.impostorBodies} w 1 call` : '--';
      }
      if (e.drawCallsFg) e.drawCallsFg.textContent = formatDrawInfo(passes?.fg);
      if (e.drawCallsBloom) e.drawCallsBloom.textContent = formatDrawInfo(passes?.bloom);
      if (e.drawCallsPost) e.drawCallsPost.textContent = formatDrawInfo(passes?.post);
      if (e.drawCallsOther) e.drawCallsOther.textContent = formatDrawInfo(passes?.other);
    }
    if (e.npcTeams) e.npcTeams.textContent = `${d.enemyNpcCount} / ${d.friendlyNpcCount} (F ${d.enemyFighterCount}/${d.friendlyFighterCount})`;
    if (e.pointLights) e.pointLights.textContent = `${d.visiblePointLightCount}/${d.pointLightCount} (eng ${d.visibleEnginePointLightCount}/${d.enginePointLightCount})`;
    if (e.counts) e.counts.textContent = `${d.bulletsCount} / ${d.npcCount} (${d.fighterCount} myśl.)`;
    if (e.wrecks) e.wrecks.textContent = `${d.hotWreckCount} / ${d.sleepingWreckCount} / ${d.coldWreckCount}`;
    this.applySectionCollapse();
  },

  drawGraph() {
    if (!this.visible || !this.graphCtx) return;
    const ctx2d = this.graphCtx;
    const graph = ctx2d.canvas;
    const w = graph.width;
    const h = graph.height;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = '#0a0e18';
    ctx2d.fillRect(0, 0, w, h);

    const drawGuide = (ms, color) => {
      const y = h - (ms / 50) * h;
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 1;
      ctx2d.setLineDash([3, 3]);
      ctx2d.beginPath();
      ctx2d.moveTo(0, y);
      ctx2d.lineTo(w, y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    };
    drawGuide(16.67, '#2a3a2a');
    drawGuide(33.33, '#3a2a2a');

    const len = this.history.length;
    const barW = w / len;
    const startIdx = this.histIdx;
    for (let i = 0; i < len; i++) {
      const idx = (startIdx + i) % len;
      const ms = this.history[idx];
      const barH = Math.min(h, (ms / 50) * h);
      const x = i * barW;
      if (ms < 17) ctx2d.fillStyle = '#2a6a3a';
      else if (ms < 33) ctx2d.fillStyle = '#6a6a2a';
      else ctx2d.fillStyle = '#6a2a2a';
      ctx2d.fillRect(x, h - barH, Math.max(1, barW - 0.5), barH);
    }
  },

  resetAccum() {
    this.accum.frameCount = 0;
    this.accum.frameMs = 0;
    this.accum.physicsTime = 0;
    this.accum.destructorTime = 0;
    this.accum.collisionTime = 0;
    this.accum.deformTime = 0;
    this.accum.aiTime = 0;
    this.accum.aiSquadsTime = 0;
    this.accum.aiSupportWingTime = 0;
    this.accum.aiNpcStepTime = 0;
    this.accum.aiNpcGridTime = 0;
    this.accum.aiNpcEnemyBrainTime = 0;
    this.accum.aiNpcFriendlyBrainTime = 0;
    this.accum.aiNpcOtherTime = 0;
    this.accum.aiPirateMissionTime = 0;
    this.accum.aiSeparationTime = 0;
    this.accum.aiWeaponScanTime = 0;
    this.accum.aiTargetPickTime = 0;
    this.accum.preAiTime = 0;
    this.accum.projectileTime = 0;
    this.accum.destructiblePrepTime = 0;
    this.accum.hardpointTime = 0;
    this.accum.hudNavTime = 0;
    this.accum.worldZoneTime = 0;
    this.accum.playerSystemsTime = 0;
    this.accum.scanUiTime = 0;
    this.accum.playerFlightTime = 0;
    this.accum.wreckPrepTime = 0;
    this.accum.ciwsTime = 0;
    this.accum.bulletGridTime = 0;
    this.accum.bulletMoveVfxTime = 0;
    this.accum.bulletInterceptTime = 0;
    this.accum.bulletNpcHitTime = 0;
    this.accum.bulletAsteroidTime = 0;
    this.accum.bulletRingTime = 0;
    this.accum.bulletMiscHitTime = 0;
    this.accum.npcFireTime = 0;
    this.accum.npcFireScanTime = 0;
    this.accum.npcFireSpawnTime = 0;
    this.accum.drawTime = 0;
    this.accum.renderPrepTime = 0;
    this.accum.render3dUpdateTime = 0;
    this.accum.render3dPlanetsUpdateTime = 0;
    this.accum.render3dRingsUpdateTime = 0;
    this.accum.render3dStationsUpdateTime = 0;
    this.accum.render3dWorldUpdateTime = 0;
    this.accum.render3dAsteroidsUpdateTime = 0;
    this.accum.render3dDestructionUpdateTime = 0;
    this.accum.render3dHexUpdateTime = 0;
    this.accum.render3dShieldsUpdateTime = 0;
    this.accum.render3dDrawTime = 0;
    this.accum.render3dCoreCallTime = 0;
    this.accum.render3dCoreRenderTime = 0;
    this.accum.render3dComposerTime = 0;
    this.accum.render3dBlitTime = 0;
    this.accum.render2dWorldTime = 0;
    this.accum.render2dNpcTime = 0;
    this.accum.render2dPlayerTime = 0;
    this.accum.render2dTurretTime = 0;
    this.accum.render2dProjectilesTime = 0;
    this.accum.render2dVfxTime = 0;
    this.accum.renderHudTime = 0;
    this.accum.renderUiTime = 0;
    this.accum.planetsTime = 0;
    this.accum.stationsTime = 0;
    this.accum.world3dTime = 0;
    this.accum.hex3dTime = 0;
    this.accum.vfxUpdateTime = 0;
    this.accum.overlayFxTime = 0;
    this.accum.contacts = 0;
    this.accum.physicsSteps = 0;
    this.accum.aiDecisionTicks = 0;
  },

  refreshDebugButtons() {
    if (!this.els) return;
    const setActive = (el, active) => {
      if (!el) return;
      el.classList.toggle('active', !!active);
    };
    const colOn = !!DestructorSystem?._liveCollisionDebug?.enabled;
    const renderOn = !!window.RenderLiveDebug?.enabled;
    const aiOn = !!window.AILiveDebug?.enabled;
    setActive(this.els.colStart, colOn);
    setActive(this.els.colStop, !colOn);
    setActive(this.els.renderStart, renderOn);
    setActive(this.els.renderStop, !renderOn);
    setActive(this.els.aiStart, aiOn);
    setActive(this.els.aiStop, !aiOn);
  },

  syncRenderToggles() {
    if (!this.els) return;
    const status = typeof window.Core3DPerfStatus === 'function' ? window.Core3DPerfStatus() : null;
    if (!status) {
      if (this.els.renderStatus) this.els.renderStatus.textContent = 'Core3D niedostepny';
      return;
    }
    if (this.els.toggleBloom) this.els.toggleBloom.checked = !!status.bloom;
    if (this.els.toggleHeat) this.els.toggleHeat.checked = !!status.heatHaze;
    if (this.els.toggleBg) this.els.toggleBg.checked = !!status.bgPass;
    if (this.els.toggleOrtho) this.els.toggleOrtho.checked = !!status.orthoPass;
    if (this.els.toggleFg) this.els.toggleFg.checked = !!status.fgPass;
    if (this.els.toggleMsaa) this.els.toggleMsaa.checked = Number(status.msaaSamples) > 0;
    if (this.els.toggleEngineLights) this.els.toggleEngineLights.checked = !!status.enginePointLights;
    if (this.els.toggleFgBldg) this.els.toggleFgBldg.checked = !!status.fgBuildings;
    if (this.els.toggleFgStations) this.els.toggleFgStations.checked = !!status.fgStations;
    if (this.els.toggleFgWeapons) this.els.toggleFgWeapons.checked = !!status.fgWeapons;
    if (this.els.toggleFgShadows) this.els.toggleFgShadows.checked = !!status.fgShadows;
    if (this.els.renderStatus) {
      this.els.renderStatus.textContent = `MSAA=${Number(status.msaaSamples) || 0} | bloom=${status.bloom ? 'on' : 'off'} | heat=${status.heatHaze ? 'on' : 'off'} | engL=${status.enginePointLights ? 'on' : 'off'}`;
    }
  }
};

export default PerfHUD;
