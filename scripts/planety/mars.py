# -*- coding: utf-8 -*-
"""Generator map Marsa w trakcie terraformacji (HULLFALL): młody ocean na północnych nizinach,
morza w basenach Hellas i Argyre, jeziora w kraterach, zieleń od brzegów i równika w górę stoków,
rude wyżyny i wulkany Tharsis bez zmian. Wejście: MOLA MEGDR 32 px/° (NASA, domena publiczna) i
dotychczasowa mapa koloru (detal gruntu). Wyjście: kolor, noc, maska wody, normalne, chmury.

  .tmp/venv-planety/Scripts/python -I scripts/planety/mars.py --szer 2048            # podgląd
  .tmp/venv-planety/Scripts/python -I scripts/planety/mars.py --szer 8192 --do-gry   # mapy gry

Dane: .tmp/planety-dane/mola/megt90n000fb.img (MSB int16, m względem areoidy, 0° E na lewej krawędzi).
"""
import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
from wspolne import *  # noqa: E402,F401,F403

R_MARSA_KM = 3389.5

P = dict(
    poziom_morza=-3900.0,
    przewyzszenie=1.6,
    ziarno=11,
    miasta=46,
)

PAL = {k: kolor(v) for k, v in dict(
    las='#2b3f25', las_jasny='#3a522b', trawa='#55602f', mech='#6c683c', porost='#856f4a',
    pole1='#6f8a3a', pole2='#a39a4e', pole3='#4f6e36',
    plaza='#a8805e', mokry='#5a3c2c',
    woda_plytka='#2c7f94', woda_srednia='#1a4c78', woda_gleboka='#0d2652', osad='#7a5a46',
    lod='#e6e2dc', miasto='#8d8a86',
).items()}
NOC = {k: kolor(v) for k, v in dict(led='#ffe6c2', kopula='#cfe6ff', ciepla='#ffc27a').items()}

WULKANY = [(-133.8, 18.65, 1.0), (-120.5, -8.3, 0.7), (-113.0, 1.0, 0.6), (-104.5, 11.8, 0.7), (147.2, 24.8, 0.5)]


def wczytaj_mola(W, H):
    cache = os.path.join(KATALOG_DANYCH, 'mola', f'mola_{W}.npy')
    if os.path.exists(cache):
        return np.load(cache)
    raw = np.fromfile(os.path.join(KATALOG_DANYCH, 'mola', 'megt90n000fb.img'), dtype='>i2').reshape(5760, 11520).astype(np.float32)
    a = np.roll(przeskaluj(raw, W, H), W // 2, axis=1)       # 0° E → środek mapy (u = 0 na 180° W)
    np.save(cache, a)
    return a


def km2_piksela(W, H):
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    return ((2 * np.pi * R_MARSA_KM / W) * (np.pi * R_MARSA_KM / H) * np.cos(lat)).astype(np.float32)[:, None]


def okno(lon0, lat0, promien_km, W, H):
    dlat = promien_km / R_MARSA_KM
    cl = max(math.cos(math.radians(lat0)), 0.05)
    dlon = dlat / cl
    j0 = max(0, int((math.pi / 2 - (math.radians(lat0) + dlat)) / math.pi * H) - 1)
    j1 = min(H, int((math.pi / 2 - (math.radians(lat0) - dlat)) / math.pi * H) + 2)
    i_c = (math.radians(lon0) + math.pi) / (2 * math.pi) * W
    di = int(dlon / (2 * math.pi) * W) + 2
    cols = np.arange(int(i_c) - di, int(i_c) + di + 1) % W
    rows = np.arange(j0, j1)
    lon = (cols + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (rows + 0.5) / H * np.pi
    dl = (lon - math.radians(lon0) + np.pi) % (2 * np.pi) - np.pi
    x = (R_MARSA_KM * np.cos(lat)[:, None] * dl[None, :]).astype(np.float32)
    y = np.broadcast_to((R_MARSA_KM * (lat - math.radians(lat0)))[:, None], x.shape).astype(np.float32)
    return rows, cols, x, y


def szum2(x, y, skala, ziarno):
    return szum3(x * skala, y * skala, np.full_like(x, ziarno * 13.37), ziarno)


def generuj(W, H, wyj, podglady):
    t0 = time.time()
    rng = np.random.default_rng(P['ziarno'])
    log = lambda m: print(f'[{time.time() - t0:6.1f} s] {m}', flush=True)  # noqa: E731
    from scipy import ndimage as ndi

    e = wczytaj_mola(W, H)
    px_km = 2 * math.pi * R_MARSA_KM / W
    S = P['poziom_morza']
    szer = np.linspace(90, -90, H, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
    log('MOLA')

    rel = e - rozmyj_kula(e, max(1.0, 70.0 / px_km))
    woda = e < S
    # jeziora w kraterach: zagłębienia niżej niż otoczenie, w cieplejszym pasie i nisko
    # zagłębienie = różnica do domknięcia morfologicznego (wypełnia misy kraterów, nie podnóża stoków)
    rozm = max(5, int(60.0 / px_km)) | 1
    zaglebienie = ndi.grey_closing(e, size=(rozm, rozm), mode=('nearest', 'wrap')) - e
    jeziora = (zaglebienie > 900) & (e < 0) & (np.abs(szer) < 40) & ~woda & (pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 5.0, 3, 17)) > 0.56)
    jeziora = ndi.binary_opening(jeziora, iterations=1)
    lab, n = ndi.label(jeziora)
    if n:
        pola = ndi.sum(np.ones_like(e), lab, index=np.arange(1, n + 1))
        ok = np.zeros(n + 1, bool)
        ok[1:] = pola >= max(4, (30.0 / px_km) ** 2)
        jeziora = ok[lab]
    woda = woda | jeziora
    glebokosc = np.where(woda, np.where(e < S, S - e, np.clip(zaglebienie - 900, 0, None) * 0.6 + 60), 0).astype(np.float32)
    dist_km = ndi.distance_transform_edt(~woda).astype(np.float32) * px_km
    log(f'woda: {100 * (woda * np.cos(np.radians(szer))).sum() / np.cos(np.radians(szer)).sum():.1f}% powierzchni, jeziora {n}')

    img = wczytaj_obraz(os.path.join(KATALOG_REPO, 'public/assets/planety/solar/mars/mars_color.jpg'), W, H)
    L = luminancja(img)
    L_tlo = rozmyj_kula(L, max(1.0, 150.0 / px_km))
    Lr = np.clip(L / np.maximum(L_tlo, 0.01), 0.5, 1.8)[..., None]
    sz_a = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 7.0, 5, P['ziarno']))
    sz_b = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 34.0, 4, P['ziarno'] + 3))
    sz_c = pole_szumu(W, H, lambda x, y, z: fbm3(x, y, z, 150.0, 3, P['ziarno'] + 5))
    log('obraz i szum')

    # ── zieleń: wilgoć od wody, ciepło od równika, chłód z wysokości ────────────
    wilg = np.exp(-dist_km / 650.0) * 0.75 + np.exp(-dist_km / 120.0) * 0.35
    cieplo = smoothstep(58, 18, np.abs(szer))
    wys = smoothstep(2500, -2500, e)
    spad = smoothstep(500, 150, np.abs(rel))
    V = (wilg * 0.7 + cieplo * 0.35) * wys * (0.55 + 0.45 * spad) * cieplo
    V = V * (0.6 + 0.8 * sz_a) + (sz_b - 0.5) * 0.18
    V = np.clip(V, 0, 1.2) * (~woda)
    kol = img.copy()
    # grunt: lekko ciemniejszy i bardziej brązowy tam, gdzie gleba wilgotnieje
    kol = mix(kol, kol * np.array([0.82, 0.78, 0.74], np.float32), smoothstep(0.1, 0.4, V))
    zielen = mix(PAL['porost'][None, None, :] * Lr, PAL['mech'][None, None, :] * Lr, smoothstep(0.42, 0.55, V))
    zielen = mix(zielen, PAL['trawa'][None, None, :] * Lr, smoothstep(0.52, 0.66, V))
    zielen = mix(zielen, PAL['las'][None, None, :] * Lr * (0.8 + 0.4 * sz_c[..., None]), smoothstep(0.66, 0.85, V))
    zielen = mix(zielen, PAL['las_jasny'][None, None, :] * Lr, smoothstep(0.55, 0.7, sz_c) * smoothstep(0.62, 0.8, V) * 0.5)
    pokrycie = smoothstep(0.36, 0.52, V) * smoothstep(0.3, 0.5, sz_b + 0.25 * V)
    kol = mix(kol, zielen, pokrycie)
    log('zieleń')

    # lód polarny (z jasności obrazu, mniejszy niż dziś)
    lod = smoothstep(0.55, 0.75, L / np.maximum(L.max(), 1e-3)) * smoothstep(74, 82, np.abs(szer))
    kol = mix(kol, PAL['lod'][None, None, :] * np.clip(L / np.maximum(L_tlo, 0.02), 0.85, 1.1)[..., None], lod * 0.9)

    # ── miasta, pola uprawne, drogi; noc ──────────────────────────────────────────
    noc = np.zeros((H, W, 3), np.float32)
    kand = np.argwhere(((dist_km < 220) | (V > 0.55)) & (~woda) & (np.abs(szer) < 55))
    miasta = []
    for k in rng.choice(len(kand), size=min(P['miasta'] * 6, len(kand)), replace=False):
        j, i = kand[k]
        lat = 90 - (j + 0.5) / H * 180
        lon = (i + 0.5) / W * 360 - 180
        if any(math.hypot((lon - a) * math.cos(math.radians(lat)), lat - b) < 7.0 for a, b, _ in miasta):
            continue
        miasta.append((lon, lat, float(rng.uniform(0.35, 1.0))))
        if len(miasta) >= P['miasta']:
            break
    for k, (lon, lat, b) in enumerate(miasta):
        r = 18 + 40 * b
        rows, cols, x, y = okno(lon, lat, r * 3.2, W, H)
        d = np.sqrt(x * x + y * y)
        # pola uprawne: prostokąty w siatce wokół miasta
        th = rng.uniform(0, math.pi)
        u = x * math.cos(th) + y * math.sin(th)
        v = -x * math.sin(th) + y * math.cos(th)
        okres = rng.uniform(6.0, 10.0)
        pole = szum2(np.floor(u / okres), np.floor(v / (okres * 0.6)), 0.77, k + 300)
        maska_pol = smoothstep(r * 3.0, r * 1.6, d) * smoothstep(r * 0.6, r * 1.0, d) * smoothstep(0.35, 0.5, szum2(x, y, 1 / 40.0, k + 301))
        barwy = np.stack([PAL['pole1'], PAL['pole2'], PAL['pole3']])
        bp = barwy[np.clip((pole * 3).astype(int), 0, 2)]
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (bp * (0.9 + 0.2 * pole[..., None]) - sub) * (maska_pol * 0.45)[..., None]
        # zabudowa i kopuły
        m = smoothstep(r * 0.7, r * 0.35, d * (0.8 + 0.4 * szum2(x, y, 1 / 9.0, k + 302)))
        sub = kol[np.ix_(rows, cols)]
        kol[np.ix_(rows, cols)] = sub + (PAL['miasto'][None, None, :] * (0.7 + 0.5 * szum2(x, y, 1 / 2.5, k + 303)[..., None]) - sub) * (m * 0.55)[..., None]
        swiat = m * (0.35 + 0.65 * smoothstep(0.4, 0.9, szum2(x, y, 1 / 2.2, k + 304))) * (0.5 + 0.7 * b)
        noc[np.ix_(rows, cols)] += NOC['led'][None, None, :] * swiat[..., None] * 0.85 + NOC['kopula'][None, None, :] * (smoothstep(0.35, 0.0, d / r) * 0.5 * b)[..., None]
        noc[np.ix_(rows, cols)] += NOC['ciepla'][None, None, :] * (maska_pol * smoothstep(0.93, 0.99, szum2(x, y, 1 / 3.0, k + 305)) * 0.35)[..., None]
    log(f'miasta {len(miasta)}')
    # osady i stacje terraformujące — rozsiane światła na zielonych terenach
    los = rng.random((H, W), dtype=np.float32)
    pkt = (los > 1.0 - 0.0012 * (2048.0 / W) ** 2 * (0.2 + 2.0 * smoothstep(0.3, 0.7, V))).astype(np.float32)
    pkt = np.clip(rozmyj_kula(pkt, 0.6) * 4.0, 0, 1) * (~woda) * (0.3 + 0.7 * rng.random((H, W), dtype=np.float32))
    noc += NOC['led'][None, None, :] * (pkt * 0.45)[..., None]
    del los

    # ── woda i brzegi ────────────────────────────────────────────────────────────
    plaza = smoothstep(7.0, 1.5, dist_km) * (~woda) * smoothstep(0.35, 0.6, sz_b)
    kol = mix(kol, mix(PAL['plaza'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['mokry'], smoothstep(3.0, 0.8, dist_km)), plaza * 0.4)
    wd = mix(PAL['woda_plytka'][None, None, :] * np.ones((H, W, 1), np.float32), PAL['woda_srednia'], smoothstep(10, 250, glebokosc))
    wd = mix(wd, PAL['woda_gleboka'], smoothstep(400, 2200, glebokosc))
    # osady niesione z brzegów (ruda zawiesina przy płyciznach)
    wd = mix(wd, PAL['osad'], smoothstep(0.55, 0.75, sz_b) * smoothstep(120, 10, glebokosc) * 0.55)
    dist_w = ndi.distance_transform_edt(woda).astype(np.float32) * px_km
    # brzeg oceanu z wysokości (gładki, podpikselowy), jeziora z odległości
    e_gl = rozmyj_kula(e, 0.8)
    t_woda = np.where(e_gl < S + 60, smoothstep(S + 60, S - 60, e_gl), smoothstep(0.0, 3.0, dist_w) * woda).astype(np.float32)
    kol = mix(kol, wd, t_woda)
    log('woda')

    # ── chmury: pasma średnich szerokości, nad oceanem gęściej, chmury orograficzne wulkanów ──
    ch_pole = pole_szumu(W, H, lambda x, y, z: fbm3(x + 0.4 * fbm3(x, y, z, 3.0, 2, 61), y, z * 1.6, 3.4, 6, 60))
    pas = 0.35 + 0.65 * smoothstep(15, 40, np.abs(szer)) * smoothstep(70, 50, np.abs(szer))
    nad_woda = rozmyj_kula(woda.astype(np.float32), max(1.0, 250.0 / px_km))
    ch = smoothstep(0.55, 0.8, ch_pole + 0.12 * nad_woda) * pas * 0.85
    oro = np.zeros((H, W), np.float32)
    for k, (lon, lat, s) in enumerate(WULKANY):
        rows, cols, x, y = okno(lon, lat, 1100 * s, W, H)
        # fale zawietrzne: pasma w poprzek wiatru (wiatr ze wschodu) za szczytem, łamane szumem, rzadnące z odległością
        u = -x - 120 * s
        war = szum2(x, y, 1 / 45.0, k + 71)
        fala = smoothstep(0.25, 0.85, 0.5 + 0.5 * np.cos((u + 70.0 * war) / (55.0 * s) * 2 * np.pi))
        obw = smoothstep(-60 * s, 80 * s, u) * smoothstep(950 * s, 300 * s, u) * smoothstep(420 * s, 120 * s, np.abs(y + 0.15 * u))
        oro[np.ix_(rows, cols)] = np.maximum(oro[np.ix_(rows, cols)], fala * obw * smoothstep(0.3, 0.7, szum2(x, y, 1 / 30.0, k + 70)) * 0.3)
    ch = np.clip(ch + oro + lod * 0.25, 0, 1)
    chm = np.repeat(ch[..., None], 3, axis=-1)                   # sRGB biel × maska
    log('chmury')

    h = np.where(woda & (e < S), np.float32(S), e).astype(np.float32)
    nrm = normalne_z_wysokosci(h, R_MARSA_KM * 1000.0, P['przewyzszenie'])
    nrm[t_woda > 0.5] = (0.0, 0.0, 1.0)
    log('normalne')

    kol_srgb = lin_do_srgb(kol)
    noc_srgb = lin_do_srgb(np.clip(noc, 0, 1))
    zapisz_rgb(os.path.join(wyj, 'mars_hf_color.jpg'), kol_srgb, 92)
    zapisz_rgb(os.path.join(wyj, 'mars_hf_night.jpg'), noc_srgb, 92)
    zapisz_rgb(os.path.join(wyj, 'mars_hf_water.jpg'), t_woda.astype(np.float32), 90)
    zapisz_rgb(os.path.join(wyj, 'mars_hf_clouds.jpg'), chm, 90)
    zapisz_normalne(os.path.join(wyj, 'mars_hf_normal.jpg'), nrm, 95)
    for nazwa, a in (('kolor', kol_srgb), ('noc', noc_srgb), ('chmury', chm), ('normalne', nrm * 0.5 + 0.5)):
        podglad(os.path.join(podglady, f'mars-{nazwa}.png'), a)
    log(f'zapis → {wyj}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--szer', type=int, default=2048)
    ap.add_argument('--do-gry', action='store_true', help='zapis do public/assets/planety/solar/mars/')
    ap.add_argument('--wyj', default=None)
    a = ap.parse_args()
    W, H = a.szer, a.szer // 2
    wyj = os.path.join(KATALOG_REPO, 'public', 'assets', 'planety', 'solar', 'mars') if a.do_gry else (a.wyj or os.path.join(KATALOG_REPO, '.tmp', 'planety', f'mars-{W}'))
    generuj(W, H, wyj, os.path.join(KATALOG_REPO, '.tmp', 'planety', f'podglad-{W}'))


if __name__ == '__main__':
    main()
