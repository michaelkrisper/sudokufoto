# Sudoku-Foto

Sudoku mit dem Handy fotografieren, sofort die Lösung sehen. Installierbare Web-App (PWA) für Android und iPhone, läuft komplett auf dem Gerät: kein Upload, kein Konto, offline nutzbar.

**App:** https://michaelkrisper.github.io/sudokufoto/

- **Live-Kamera mit Auto-Auslöser:** Sudoku ins Bild halten, sobald es eindeutig lösbar erkannt ist, erscheint die Lösung. Alternativ Auslöser oder ein Foto aus der Galerie.
- **Gedreht oder schräg fotografiert** ist egal: Perspektive wird entzerrt, Querformat und Kopfüber werden erkannt.
- **Handschrift:** In einem angefangenen Sudoku werden Bleistift- und Kugelschreiber-Einträge von den gedruckten Ziffern unterschieden. Die Lösung zeigt dann, welche eigenen Einträge falsch sind.
- **Prüfen und korrigieren:** Unsichere Ziffern sind markiert, jede Zelle lässt sich per Ziffernblock ändern; Sudokus lassen sich auch ganz von Hand eingeben.
- **Lösung direkt im Foto:** die fehlenden Ziffern werden ins entzerrte Foto geschrieben.

## Wie es funktioniert

Alles ist Vanilla JS ohne Build-Schritt und ohne Bibliotheken.

| Datei | Aufgabe |
|---|---|
| `js/detect.js` | Adaptive Schwelle, Zusammenhangskomponenten, Raster als größtes Viereck auf der konvexen Hülle, geprüft über das Linienmuster; Entzerrung per Homographie; Ziffern je Zelle freistellen |
| `js/ocr.js`, `js/model.js` | Kleines neuronales Netz (576 → 128 → 9, int8, 100 KB) für die Ziffern |
| `js/hand.js` | Druck oder Handschrift: Höhe, relative Schwärze, Farbe; der Löser entscheidet mit |
| `js/read.js` | Gesamter Ablauf inkl. Ausrichtung (die Orientierung mit den meisten sicher gelesenen Ziffern gewinnt) |
| `js/solver.js` | Backtracking mit Bitmasken, erkennt mehrdeutige und unlösbare Sudokus |
| `js/worker.js` | Erkennung im Web Worker, damit die Kamera flüssig bleibt |

Das Netz ist mit Ziffern aus **synthetischen Handyfotos** trainiert (`tools/synth.py`: zufällige Sudokus in über 100 Schriften, mit Perspektive, Drehung, Schatten, Unschärfe, Rauschen und JPEG-Artefakten), ausgeschnitten mit genau demselben JS-Code wie in der App. Validiert wird mit Schriftfamilien, die beim Training nie vorkamen.

## Entwicklung

```sh
npm install
npm run serve          # http://localhost:8792
npm test               # Löser + Erkennung auf synthetischen Fotos (braucht python3 mit Pillow + numpy)
npm run lint
python3 -m http.server 8792 & node scripts/e2e.mjs   # headless Chrome mit Fake-Kamera
```

Erkennung messen und Netz neu trainieren:

```sh
tools/synth.py /pfad/test --n 100 --turns        # Testfotos (PGM + cases.json)
node tools/eval.mjs /pfad/test --verbose
tools/synth.py - --n 300 --fonts train | node tools/extract.mjs train-1.bin   # mehrfach, andere --seed
tools/synth.py - --n 300 --fonts test  | node tools/extract.mjs val.bin
tools/train.py train-*.bin --val val.bin         # schreibt js/model.js
```

Nach App-Änderungen lädt der Service Worker (Network-first) beim nächsten Start automatisch die neue Version.

## Lizenz

MIT
