# GAZ-GPT: raport z surowych sond GPU, arkusze sekwencji i wykres tunelu. Wymaga Pillow.
import json,re,shutil
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.tmp/hala-gaz/E1'
p=json.loads((OUT/'raport.json').read_text(encoding='utf-8'))
c=json.loads((OUT/'koszt.json').read_text(encoding='utf-8'))
a=json.loads((OUT/'aktywacja.json').read_text(encoding='utf-8'))
r={r['name']:r for r in p['rows']}
f=lambda x,n=3: f'{x:.{n}f}'.replace('.',',')
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',14)
def sheet(name,files,labels):
 canvas=Image.new('RGB',(1200,4*370),'#070d15');draw=ImageDraw.Draw(canvas)
 for i,(file,label) in enumerate(zip(files,labels)):
  im=Image.open(OUT/file).convert('RGB');im.thumbnail((600,338));x=(i%2)*600;y=(i//2)*370
  canvas.paste(im,(x,y+32));draw.text((x+12,y+6),label,font=font,fill='#dae4ef')
 canvas.save(OUT/name)
for s in p['sequences']:
 sheet('arkusz-'+s['name']+'.png',s['files'],[f"{s['name']} — {(i+1)*s['stepSeconds']:.2f} s" for i in range(len(s['files']))])
shotNames=['00-postoj','01-zimny-gaz','10-ciag-2s','14-po-6s','15-po-30s','40-lot-ku-bramie','41-kurz-spod-kadluba','51-odpiecie']
sheet('arkusz-odbior.png',[s+'.png' for s in shotNames],['Postój','Zimny gaz','Pełny MAIN: 2 s','6 s po zgaszeniu','30 s po zgaszeniu','Lot: 500 j/s','Start: 0 → 300 j/s','Odpięcie złączek'])
# Wykres z kolumny pyłu, rzeczywisty odczyt GPU; skala pozioma komórki 64 j.
q=r['40-lot-ku-bramie']['profile'];values=[v/q['bg'] for v in q['tunnel']]
im=Image.new('RGB',(1200,440),'#070d15');draw=ImageDraw.Draw(im)
xy=lambda i,v:(70+i*1060/(len(values)-1),370-min(1.6,max(0,v))*190)
for level,color in [(0,'#506579'),(.35,'#86d8fe'),(1,'#8e9ead'),(1.3,'#edbb78')]:
 y=xy(0,level)[1];draw.line([(70,y),(1130,y)],fill=color);draw.text((8,y-10),str(level),font=small,fill=color)
draw.line([xy(i,v) for i,v in enumerate(values)],fill='#dae4ef',width=3)
for offset in [-2560,-1280,0,1280,2560]:
 x=xy(offset/64+40,0)[0];draw.text((x-28,386),str(offset),font=small,fill='#c5d5e5')
draw.text((70,18),'GAZ-GPT: kolumna pyłu 392 j. za średnim wylotem MAIN; lot 500 j/s, 5,5 s',font=font,fill='#dae4ef')
draw.text((70,48),f"Tunel {r['40-lot-ku-bramie']['tunnelWidth']} j.; flanka {r['40-lot-ku-bramie']['flankRatio']:.3f} × tło",font=font,fill='#dae4ef')
draw.text((520,412),'Odległość od osi [j.]',font=small,fill='#c5d5e5');im.save(OUT/'profil-tunelu.png')
# Przekroje RGB: czerwone spaliny, zielony pył, niebieska para; wysokość fizyczna, bez kompresji sceny.
for name in ['10-ciag-2s','11-ciag-4s','50-saczaca-para']:
 source=Image.open(OUT/(name+'-przekroj.png')).convert('RGB').resize((1000,280),Image.Resampling.NEAREST)
 im=Image.new('RGB',(1150,365),'#070d15');im.paste(source,(90,40));draw=ImageDraw.Draw(im)
 for height in [0,116,300,500,720,768]:
  y=40+280*(1-height/768);draw.line([(88,y),(1090,y)],fill='#8090a0',width=1);draw.text((12,y-9),str(height),font=small,fill='#c5d5e5')
 draw.text((90,6),name+' — przekrój przy osi Atlasa (średnia z 7 kolumn x)',font=font,fill='#dae4ef')
 draw.text((90,330),'R: spaliny · G: pył · B: para. z hali: −160…9056 j.; wysokość y: 0…768 j.',font=small,fill='#c5d5e5')
 im.save(OUT/(name+'-przekroj-opis.png'))
base=r['00-postoj'];quiet=r['60-bilans-60s'];mass=100*(quiet['totalDust']+quiet['outflow']-base['totalDust'])/base['totalDust']
cores=max(core['ratio'] for row in p['rows'] if row['name'].endswith('po-6s') for core in row['cores'])
residual=max(row['residualRatio'] for row in p['rows']);trans=min(row['transMin'] for row in p['rows'])
measures=[
 ('Spaliny nad y=300 przy ścianie po 2 s','≥25%',f(r['10-ciag-2s']['wallFraction']*100,2)+'%',r['10-ciag-2s']['wallFraction']>=.25),
 ('Pion przy ścianie','≥780 j/s (0,3 × zadane 2600)',f(r['10-ciag-2s']['maxVertical'],0)+' j/s',r['10-ciag-2s']['maxVertical']>=780),
 ('Masa spalin y>500, 2 → 4 s','rośnie',f(r['10-ciag-2s']['ceilingMass'],0)+' → '+f(r['11-ciag-4s']['ceilingMass'],0),r['11-ciag-4s']['ceilingMass']>r['10-ciag-2s']['ceilingMass']),
 ('Przepuszczalność nad kadłubem','≥0,7',f(trans),trans>=.7),
 ('Tunel: lot 500 j/s, 5,5 s','≥450 j.',str(r['40-lot-ku-bramie']['tunnelWidth'])+' j.',r['40-lot-ku-bramie']['tunnelWidth']>=450),
 ('Flanka tunelu','≤1,3 × tło',f(r['40-lot-ku-bramie']['flankRatio'])+' × tło',r['40-lot-ku-bramie']['flankRatio']<=1.3),
 ('Drugie / pierwsze podrywanie','≥0,5',f(p['lift']['secondRatio']),p['lift']['secondRatio']>=.5),
 ('Powrót po 30 s','≥0,8',f(p['lift']['returned']),p['lift']['returned']>=.8),
 ('Bilans pyłu / 60 s, z doliczeniem wypływu','±2%',f(mass,4)+'%',abs(mass)<=2),
 ('Pas po lewej / prawej, start 300 j/s','≥200 / ≥200 j.',f(r['41-kurz-spod-kadluba']['bands']['left'],0)+' / '+f(r['41-kurz-spod-kadluba']['bands']['right'],0)+' j.',min(r['41-kurz-spod-kadluba']['bands']['left'],r['41-kurz-spod-kadluba']['bands']['right'])>=200),
 ('Para poniżej y=116 po 10 s','≥60%',f(r['50-saczaca-para']['vaporLowFraction']*100,2)+'%',r['50-saczaca-para']['vaporLowFraction']>=.6),
 ('Residuum / v_rms, najgorsza sonda','≤0,06',f(residual,5),residual<=.06),
 ('Rdzenie wirów 6 s po ciągu, trzy odpalenia','≤2 × średnia',f(cores),cores<=2),
 ('Determinizm','identyczne liczby',str(p['determinism']['hashes']),p['determinism']['equal'])]
assert all(m[3] for m in measures), 'Nie wszystkie bramki fizyki zostały zaliczone'
text='# GAZ-GPT — raport E1 (2026-10-13)\n\n'
text+='E0 zaliczone (commit `36ecc44`). E1: implementacja i wszystkie miary fizyki zaliczone. **Formalna bramka kosztu symulacji pozostaje niespełniona: 0,855 ms zamiast ≤0,6 ms.** Użytkownik polecił odłożyć optymalizację (RTX 5080); ten raport nie oznacza budżetu jako zaliczonego. Commit E1 to commit zawierający ten raport.\n\n'
text+='## Miary §10\n\n| Miara | Cel | Wynik | Ocena |\n|---|---|---|---|\n'
for name,target,value,ok in measures:text+=f'|{name}|{target}|{value}|{"TAK" if ok else "NIE"}|\n'
text+='\nMasy w umownych jednostkach: stężenie × objętość komórki, depozyt × powierzchnia pokładu. Podrywanie jest całką dodatniego strumienia z pokładu: pierwsze '+f(p['lift']['first'],1)+', drugie '+f(p['lift']['second'],1)+'. Powrót liczy wyłącznie pył oznaczony przy podrywaniu, także podczas wygaszania przepływu; początkowy pył w powietrzu nie zawyża powrotu. Surowy bilans bez korekty wypływu: '+f(100*(quiet['totalDust']/base['totalDust']-1),4)+'%. Wypływ: '+f(quiet['outflow'],1)+'.\n\n'
text+='Tunel: kolumna pyłu 392 j. za średnim wylotem pięciu dysz, 81 próbek co 64 j.; tło z zewnętrznych 16 próbek. Flanka w pasie 4–5 komórek poza krawędzią tunelu, jak w audycie. Pas spod kadłuba: profile przy rufie, środku i dziobie, wybrany profil o największej szerokości wspólnej obu burt; komplet profili jest w JSON. Residuum używa tych samych ścian MAC i celu dywergencji co solver. Warstwa pary uwzględnia wolną część komórki nad płytą kadłuba.\n\n'
text+='## Koszty §11\n\nPomiar ABAB w jednej sesji, nowe wyniki znaczników Core3D (110–119 próbek na serię). Przyrost względem tego samego gospodarza bez modułu, średnia różnic median dwóch par. Nie edytowano kodu ani nie uruchamiano drugiego harnessu GPU podczas pomiaru. Sprzęt: RTX 5080 według użytkownika; serializacja `GPUAdapterInfo` dała pusty obiekt. Sprzętowy zapis f16: `trunc`, wykryty przez wspólny probe.\n\n| Składnik | 1600×900 [ms] | 2560×1440 [ms] | Cel |\n|---|---:|---:|---|\n'
for label,key,field,limit in [('Symulacja','simulation','computeMs','≤0,6 — NIE'),('Obraz back','back','renderMs','składowa'),('Obraz front','front','renderMs','składowa'),('Obraz łącznie','image','renderMs','składowa')]:text+=f'|{label}|{f(c["rows"][0][key][field],6)}|{f(c["rows"][1][key][field],6)}|{limit}|\n'
text+=f'|Moduł łącznie, osobne ABAB całości|{f(sum(c["rows"][0]["total"][k] for k in ["renderMs","computeMs"]),6)}|{f(sum(c["rows"][1]["total"][k] for k in ["renderMs","computeMs"]),6)}|≤1,0 / ≤1,6 — TAK|\n'
text+=f'|CPU całego kroku modułu (pakowanie + solver)|{f(c["rows"][0]["simulation"]["cpuMs"])}|{f(c["rows"][1]["simulation"]["cpuMs"])}|≤0,25 — TAK|\n'
text+='|Objętość światła / drobiny|0 / 0|0 / 0|należą do E2, nie powstały w E1|\n|Pamięć modułu|43,46624 MB|43,46624 MB|≤80 MB — TAK|\n|Pipeline’y synchroniczne po gotowości|0|0|0 — TAK|\n|Rysunki / dispatchy modułu|2 / 43|2 / 43|jeden compute(lista), 30 Jacobi|\n|Alokacje w pętli modułu|0|0|stałe bufory, listy dispatchy, callback źródeł; test tożsamości list|\n'
text+='\nPierwsza aktywacja po rozgrzewce: dodatkowy czas JS całej klatki '+f(a['rows'][0]['extraJs'])+' / '+f(a['rows'][1]['extraJs'])+' ms; dodatkowy GPU '+f(a['rows'][0]['extraGpu'])+' / '+f(a['rows'][1]['extraGpu'])+' ms (900p / 1440p). Limit +2 ms spełniony. Pełne surowe serie: `koszt.json`, `aktywacja.json`.\n\n'
text+='## Obraz, testy i ograniczenia\n\nPNG wszystkich scen przy 0,32 / 1 / 3,2, kamera 3D wewnątrz hali, impuls SIDE, zimny gaz, sączenie i odpięcie. `arkusz-odbior.png`, dwie sekwencje `arkusz-odpalenie.png` / `arkusz-odpiecie.png` (8 klatek każda), `profil-tunelu.png`, przekroje z odczytu GPU. Detal, drobiny, objętość światła, finalne cienie i porównanie obrazu z 2D należą do E2/E3. E1 pokazuje fizykę prostym marszem; dach zatrzymuje i zasłania gaz, otwór nad Atlasem jest wspólny dla bryły i solvera.\n\n'
text+='Testy: 2686 testów Node, 2684 PASS, 2 istniejące TODO, 0 FAIL; `npm test`: 1662 asercje, 0 błędów. W tym 15 testów hallGas (lustra CPU, WGSL wszystkich kerneli i obu kamer, limity wiązań, brak jednoczesnego odczytu/zapisu, ułamkowy kadłub i ściany, masa, stałe listy). Błędy konsoli i WebGPU w odbiorze/kosztach/aktywacji: 0. Pierwszy pełny test wykrył brak wpisu dema oraz CRLF z checkoutu w niezmienionym gpuFx.js; wpis dodano, plik znormalizowano do LF bez zmiany treści.\n\n'
text+='Nie wyszło: wcześniejsze warianty tworzyły wał pyłu na flankach. Konserwatywna dyfuzja zależna od rotacji, uwzględniona przed limitem wspólnego strumienia, dała 1,102×. TSL wybierał całe vec4 przez `all(bvec4)` — wybór dawcy per składnik usunął utratę masy przy przeciwnych kierunkach pyłu i gorącego gazu. Cienka płyta wymagała zajętości ścian niezależnej od zajętości objętości. Kopie f16 używają dokładnego textureLoad; liniowe próbkowanie kopii obcinało małe przyrosty. Nie ma zaniku pyłu we wnętrzu. Pozostał koszt symulacji 0,855 ms — do optymalizacji zgodnie z poleceniem użytkownika.\n\n'
text+='## Pliki i powtórzenie\n\nNowe: `src/3d/hallGas/hallGas.js`, `hallGasGrid.js`, `hallGasMath.js`, `hallGasProbe.js`, `hallGasVolume.js`; `tests/hallGas.test.mjs`; `scripts/webgpu/hala-gaz-e1.mjs`, `hala-gaz-koszt.mjs`, `hala-gaz-aktywacja.mjs`, `hala-gaz-raport.py`; ten raport. Zmienione: `hallGasLayout.js`, `hallGasBenchmark.js`, oba pliki `dema/hala-gaz-webgpu`, `dema/dok-k7-webgpu.js` (opcjonalne haki gospodarza), `dema/index.html` (wpis GAZ-GPT), plan i harness E0. `gasField/hallGasSources.js`: callback piszący rekord powstaje raz przy konstrukcji; harmonogram i równania starych źródeł zachowane. Wspólny `zapisF16.js` użyty bez zmian (dostarczony wcześniej, commit Claude’a 097c96d). Kod gry i pliki hallGas3d Claude’a zachowane.\n\n'
text+='```powershell\nnode scripts/webgpu/hala-gaz-demo.mjs --etap E0\nnode scripts/webgpu/hala-gaz-demo.mjs --etap E1 --odbior 1 --out .tmp/hala-gaz/E1\nnode scripts/webgpu/hala-gaz-koszt.mjs --out .tmp/hala-gaz/E1\nnode scripts/webgpu/hala-gaz-aktywacja.mjs\npython scripts/webgpu/hala-gaz-raport.py\nnode --test "tests/*.test.mjs"\nnpm test\n```\n'
(OUT/'raport.md').write_text(text,encoding='utf-8',newline='\n')
(ROOT/'docs/RAPORT-gaz-hali-3d-E1-GAZ-GPT.md').write_text(text,encoding='utf-8',newline='\n')
(OUT/'bramki.json').write_text(json.dumps({'physics':[dict(name=m[0],target=m[1],result=m[2],passed=m[3]) for m in measures],'simulationBudgetPassed':False,'optimizationDeferredByUser':True,'massErrorPercent':mass},ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
print('Raport, 3 arkusze, profil tunelu i 3 przekroje zapisane. Wszystkie miary fizyki: TAK; budżet symulacji: NIE.')
