# Shift Scheduler — plan (wersja uproszczona)

## Kontekst
Poprzedniego planu nigdzie nie ma: repo nie ma remote'a, a jedyny commit to szablon Next. Obecny kod to ręczny edytor zmian (FullCalendar) z silnikiem walidacji opartym na godzinach. Nowe założenia:
- nazwa **Shift Scheduler** (repo `DamianGRZ/Shift-Scheduler`, wcześniej PlannerWizan → Automatyczny Grafik),
- grafik kwartalny generowany **algorytmem genetycznym**, z pętlą: stop → popraw → akceptuj → wznów.

Zasada implementacji: jak najmniej plików i abstrakcji, stałe w kodzie zamiast konfiguracji, jedna reprezentacja grafiku.

## Wymagania (bez zmian)
- **Godziny otwarcia:**
  - poniedziałek–sobota 6:30–18:30,
  - niedziela handlowa 8–13,
  - niedziela niehandlowa, święta i Wigilia zamknięte,
  - Wielka Sobota do 14:00.
- **Kody zmian:**
  - `D` 6:30–18:30 (12h),
  - `R` 6:30–12:30 (6h),
  - `P` 12:30–18:30 (6h),
  - `N` 8–13 (5h),
  - `U` urlop (zmniejsza wymiar o 8h),
  - `-` wolne.
- **Obsada:** rano R+D ≥ 2, po południu P+D ≥ 2, w niedzielę N ≥ 2.
- **Doba pracownicza:** po `P` nie może być `R`/`D` następnego dnia. Dla wpisu użytkownika to tylko ostrzeżenie, a sam wpis jest nienaruszalny.
- **Limity tygodniowe:** maks. 48h w tygodniu, 35h nieprzerwanego odpoczynku.
- **Niedziele:** 1 wolna niedziela na 4 tygodnie; maks. 2 z 3 grudniowych niedziel handlowych.
- **Wymiar:** 496h na kwartał, chyba że użytkownik wpisze inną wartość. Liczony × etat, minus 8h za każdy dzień urlopu; dla osoby tymczasowej proporcjonalnie do okresu zatrudnienia. Odchylenie od wymiaru to kara miękka.
- **Urlopy:** wpisuje je użytkownik, a aplikacja podpowiada tygodnie, w których urlop jest możliwy (z uwzględnieniem osoby „na wyurlopowanie”).

## 1. Nazwa i porządek
- `package.json` (`shift-scheduler`), tytuł i nawigacja w `src/app/layout.tsx`, `src/app/page.tsx`.
- Plik bazy `shift-scheduler.db` w `src/db/index.ts` i `drizzle.config.ts`.
- Plan zapisany w repo jako `PLAN.md`; commit na nowej gałęzi. Push na GitHuba tylko po Twojej zgodzie.

## 2. Dane — jedna tabela na grafik (`src/db/schema.ts`)
- **`employees`:** + `fte` (domyślnie 1), `employedFrom`, `employedTo` (null = brak ograniczenia). Osoba „na wyurlopowanie” to po prostu pracownik z datą `employedTo`.
- **`schedules`:** `year`, `quarter`, `hoursOverride` (null = 496), `status`.
- **`assignments`** zastępuje `shifts`. Kolumny: `scheduleId`, `employeeId`, `date`, `code`, `locked`, unikalne (scheduleId, employeeId, date).
  - Urlop to wiersz `U` z `locked=true`, więc nie ma osobnej tabeli urlopów.
  - Champion GA to wiersze z `locked=false`, a zaakceptowane fragmenty to `locked=true`. Nie ma osobnego „stanu GA” w bazie: wznowienie startuje z tego, co jest zapisane.
- **Usunięte:** `public_holidays`, `trading_sundays` (kalendarz liczony w kodzie), `settings` (nie ma już przełączników).
- Seed: tylko przykładowi pracownicy.

## 3. Logika — trzy pliki w `src/lib/`
**`calendar.ts`:**
- data Wielkanocy, lista świąt dla roku, niedziele handlowe, Wielka Sobota,
- funkcja `dayKind(date)` zwraca jedno z: `workday` / `tradingSunday` / `closed` / `holySaturday`.

**`rules.ts`:**
- stałe godzin zmian,
- funkcja `check(grid, ctx)` zwraca listę naruszeń `{rule, employee?, date, hard, amount}`.
- Ta sama funkcja służy jako walidator w UI i jako funkcja oceny w GA (kara = Σ waga × amount). Zastępuje dotychczasowy katalog `validation/rules/**` oraz `engine.ts`.
- Reguły:
  - obsada,
  - doba,
  - 48h na tydzień,
  - 35h odpoczynku,
  - wolna niedziela co 4 tygodnie,
  - grudzień 2 z 3,
  - zgodność z wymiarem,
  - nadmiar obsady i równy rozkład niedziel oraz zmian D (kary miękkie),
  - zmiana w dniu zamkniętym lub poza okresem zatrudnienia.

**`ga.ts`:**
- `grid` = `string[][]` (pracownik × dzień), `locked` = `boolean[][]`.
- `allowed(day, emp)` → dozwolone kody: `-RPD`, `-N` albo `-`.
- Operatory: mutacja pojedynczego genu, zamiana dwóch pracowników w tym samym dniu, krzyżowanie blokami tygodni, selekcja turniejowa, elita.
  - Geny z `locked` są zawsze pomijane.
- Populacja startowa:
  - gdy jest champion (poprzedni wynik): on sam + jego mutanty + ~10% losowych,
  - gdy go nie ma: losowe osobniki.
- `suggestLeaves(grid, ctx)`: dla każdego pracownika i tygodnia sprawdza dwa warunki:
  - w każdym dniu zostają co najmniej 2 dostępne osoby,
  - suma 48h dostępnych osób pokrywa godziny otwarcia w tym tygodniu.
  Prosta heurystyka; prawdziwą weryfikację robi potem GA.
- Losowanie przez prosty generator z ziarnem (mulberry32), żeby testy były powtarzalne.

## 4. Uruchamianie GA — bez Web Workera
- W komponencie klienta pętla `async`: co 50 generacji odświeża championa na ekranie i wywołuje `await setTimeout(0)`, żeby UI nie zamarzał. Flaga `stopped` przerywa pętlę.
- Rozmiar to ok. 5 osób × 91 dni, więc wystarczy to bez workerów i komunikacji przez wiadomości.
- **Stop** → champion zostaje w tabeli i jest zapisywany jednym `PUT`.
- **Edycja:**
  - klik w komórkę zmienia kod i ją blokuje,
  - przeciągnięcie zaznacza zakres,
  - **Akceptuj** blokuje zaznaczenie,
  - **Odblokuj** zdejmuje blokadę.
- **Wznów** → GA startuje od aktualnej tabeli; zablokowane geny są stałe we wszystkich dzieciach.

## 5. API (proste, zod tylko przy zapisie)
- `employees`: GET / POST / PUT / DELETE.
- `schedules`: GET (lista lub `?id`), POST, PUT (status, `hoursOverride`), DELETE.
- `assignments`: GET `?scheduleId`, PUT — zastępuje cały grid grafiku w jednej transakcji.
- Usunięte: `shifts`, `settings`, `holidays`, `validate`. Walidacja odbywa się w przeglądarce przez `rules.check`.

## 6. UI
- `src/app/schedules/[id]/page.tsx`:
  - tabela pracownik × dzień w kwartale,
  - wiersz obsady (rano / po południu),
  - kolumna godzin vs wymiar, sumy tygodni,
  - lista naruszeń z `check`,
  - przyciski: Generuj/Wznów, Stop, Akceptuj, Odblokuj, Podpowiedz urlopy, Zatwierdź.
- Usunięte: `ScheduleCalendar.tsx` i zależności FullCalendar, strona ustawień.
- `employees/page.tsx`: pola etatu i okresu zatrudnienia.

## Krytyczne pliki
`package.json`, `src/db/{schema,index,seed}.ts`, `drizzle.config.ts`, `src/lib/{calendar,rules,ga}.ts`, `src/app/api/{employees,schedules,assignments}/route.ts`, `src/app/schedules/[id]/page.tsx`, `src/app/employees/page.tsx`, `src/app/layout.tsx`.

Przed pisaniem kodu Next: przeczytać odpowiednie przewodniki w `node_modules/next/dist/docs/` (route handlers, client components).

## Weryfikacja
- **`npm test`**, plik `src/lib/__tests__/`:
  - `calendar`: święta i niedziele handlowe 2025 i 2026,
  - `rules`: ręcznie złożone gridy (brak obsady, P → R, 50h w tygodniu, brak wolnej niedzieli, odchylenie od wymiaru),
  - `ga`: dla ziarna i 5 osób na IV kwartał 2026 brak naruszeń twardych, godziny w granicach ±6h od wymiaru, zablokowane geny bez zmian; po wznowieniu kara nie gorsza niż kara championa,
  - `suggestLeaves`: z osobą tymczasową tydzień urlopu jest możliwy, bez niej nie.
- **Ręcznie:** `npm run db:setup` → `npm run dev`. Utworzyć IV kwartał 2026, wpisać urlop, Generuj → Stop → poprawić i zaakceptować tydzień → Wznów. Sprawdzić, że zaakceptowany fragment się nie zmienił.
- `npm run build`, `npm run lint`.
