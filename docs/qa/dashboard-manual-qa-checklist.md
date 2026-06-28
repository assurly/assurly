# Dashboard — manuálny QA checklist (375 / 768 / 1280)

Použi DevTools device toolbar alebo reálne zariadenie. Pre každý viewport prejdi celý checklist.
Automatizovaný ekvivalent: `npm run test:e2e:qa-gate -w apps/web`

## Pred testom

- [ ] `npm run dev` beží v `apps/web` (alebo testuj proti staging)
- [ ] Prihlásený GitHub účet s aspoň 2 repozitármi a históriou scanov
- [ ] Hard refresh (`Cmd+Shift+R`)

---

## 375px — mobile

### Layout & navigácia

- [ ] Header: logo + hamburger account menu (bez horizontálneho scrollu stránky)
- [ ] Workspace strip: zbalený defaultne, po tapnutí ukáže „Active Workspace“
- [ ] Taby **Repositories** / **Manual Checker** sú čitateľné a prepínateľné

### Repozitáre

- [ ] Filter „Filter repositories“ zuží zoznam pri písaní
- [ ] Výber iného repa okamžite skryje starý Ship Gate / findings (žiadny flash predchádzajúceho repa)
- [ ] Prázdny repo ukáže empty state, nie staré výsledky

### Scan workspace

- [ ] Scan history rail: horizontálny scroll, chip ukazuje `commit abc1234 · HH:MM`
- [ ] Duplicitné SHA majú badge `#N of M`
- [ ] **Jump to results** scrollne k `#scan-details-container`
- [ ] **Run Secure Scan** funguje (alebo zobrazí čestnú chybu)

### Show details & dedup

- [ ] „Show details · N findings“ je defaultne zbalené
- [ ] Opakované env nálezy sú zlúčené (×N badge), nie N identických kariet
- [ ] Po prepnutí repa / scanu je panel opäť zbalený

### Ikony & štýly

- [ ] V chrome (header, tabs, repo list, workspace) nie sú emoji ikony
- [ ] Žiadne „rozbité“ layouty / text truncation mimo Ship Gate wrap

---

## 768px — tablet

- [ ] Workspace strip stále kompaktný (nie plná desktop karta)
- [ ] Repo list + scan panel sú pod sebou alebo v 1 stĺpci bez overflow
- [ ] Scan history rail scroll funguje dotykom / trackpadom
- [ ] Jump to results + repo switch prechádzajú rovnako ako na 375px
- [ ] Account menu sa otvorí a zatvorí (Escape / tap outside)

---

## 1280px — desktop

- [ ] Plná workspace karta (nie mobile strip)
- [ ] Repo list vľavo, scan workspace vpravo
- [ ] Filter + repo switch + scan history
- [ ] **Jump to results** nie je v chrome (desktop layout); scan details sú priamo vpravo
- [ ] Ship Gate + Show details čitateľné pri dlhých env/blocker labeloch
- [ ] Share report label: Pro → „Share report“, Free → „Share report (Pro)“

---

## Regresné signály (STOP — nahlas bug)

| Symptóm                                     | Pravdepodobná regresia        |
| ------------------------------------------- | ----------------------------- |
| Starý repo finding viditeľný po switchi     | stale state                   |
| Show details ostane otvorené po novom scane | details reset                 |
| Duplicitné env karty                        | dedupe                        |
| Jump scrollne na zlý element                | `scrollToScanDetails` handler |
| CI finding ukazuje „Run locally“            | `rule_id`                     |
| Emoji 📁 v repo list                        | icon regression               |

---

## Sign-off

| Viewport | Tester | Dátum | Pass/Fail |
| -------- | ------ | ----- | --------- |
| 375px    |        |       |           |
| 768px    |        |       |           |
| 1280px   |        |       |           |

**Poznámky:**

---

## Automatizovaná náhrada (CI)

| Checklist oblasť               | Test                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| 375 repo switch, history, jump | `tests/e2e/dashboard-mobile.spec.ts`                       |
| 375/768/1280 QA gate           | `tests/e2e/dashboard-qa-gate.spec.ts` (jump len `≤992px`)  |
| Overflow + chrome emoji        | QA gate „renders without horizontal overflow“ + emoji scan |
| Unit/integration regresie      | `npm run test -w apps/web` (dashboard scope)               |
