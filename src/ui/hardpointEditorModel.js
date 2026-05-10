export function collapseSideMountPaletteId(mount) {
  const raw = String(mount || 'auto').toLowerCase();
  if (raw === 'upper_left' || raw === 'upper_right' || raw === 'upper_auto') return 'engine_side_u';
  if (raw === 'center_left' || raw === 'center_right' || raw === 'center_auto') return 'engine_side_c';
  if (raw === 'lower_left' || raw === 'lower_right' || raw === 'lower_auto') return 'engine_side_l';
  return 'engine_side';
}

export function resolveHardpointEditorPaletteId({ tool, hardpointType = 'main', engineMount = 'auto' } = {}) {
  if (tool === 'erase') return 'erase';
  if (tool === 'hardpoint') return `hp_${String(hardpointType || 'main').toLowerCase()}`;
  if (tool === 'core') return 'core';
  if (tool === 'bridge') return 'bridge';
  if (tool === 'engine_main') return 'engine_main';
  if (tool === 'engine_side') return collapseSideMountPaletteId(engineMount);
  return 'hp_main';
}
