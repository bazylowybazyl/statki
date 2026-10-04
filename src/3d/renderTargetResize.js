// three r183: RenderTarget.setSize() zwalnia GPUTexture przez dispose CELU, bez
// zdarzenia dispose tekstury ani zmiany jej version. Stare wiązanie SampledTexture
// może więc nie zauważyć utraty zasobu. Przy przebudowie grupy (np. bloom wł./wył.)
// WebGPUBindingUtils czyta wtedy mipLevelCount z undefined.
// Dotyczy też tekstur w wyłączonych gałęziach shadera: nadal muszą mieć wiązanie.
export function resizeRenderTarget(target, width, height, renderer = null) {
  if (!target) return;
  const changed = target.width !== width || target.height !== height;
  target.setSize(width, height);
  if (!changed) return;
  // Zawiadom istniejące wiązania; zachowaj obiekty tekstur i grafy materiałów.
  for (const texture of target.textures) texture.needsUpdate = true;
  // Cel może nie mieć passa w następnej klatce (DIST w menu, halo poza kadrem).
  // Publiczne API odtwarza załączniki z prawidłowymi rozmiarami i liczbą próbek.
  if (renderer) renderer.initRenderTarget(target);
}
