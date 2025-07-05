# Bijdragen aan Stamjer Kalender Applicatie

Bedankt voor je interesse in het bijdragen aan de Stamjer Kalender Applicatie! Dit document bevat richtlijnen en informatie voor bijdragers.

## 📋 Inhoudsopgave

- [Gedragscode](#gedragscode)
- [Aan de slag](#aan-de-slag)
- [Ontwikkelproces](#ontwikkelproces)
- [Code Stijl Richtlijnen](#code-stijl-richtlijnen)
- [Commit Bericht Richtlijnen](#commit-bericht-richtlijnen)
- [Pull Request Proces](#pull-request-proces)
- [Bug Rapportages](#bug-rapportages)
- [Functieverzoeken](#functieverzoeken)

## 🤝 Gedragscode

Dit project volgt een eenvoudige gedragscode:

- Wees respectvol en inclusief
- Focus op constructieve feedback
- Help een positieve omgeving te behouden
- Wees geduldig met beginners

## 🚀 Aan de slag

### Vereisten

- Node.js v16 of hoger
- npm (komt met Node.js)
- Git
- Basiskennis van React en Express.js

### Ontwikkelomgeving Instellen

1. **Fork de repository** op GitHub
2. **Kloon je fork** lokaal:
   ```bash
   git clone https://github.com/JOUW-GEBRUIKERSNAAM/stamjer-kalender.git
   cd stamjer-kalender
   ```
3. **Installeer dependencies:**
   ```bash
   npm install
   ```
4. **Stel omgevingsvariabelen in:**
   ```bash
   cp .env.example .env
   # Bewerk .env met jouw configuratie
   ```
5. **Start de ontwikkelomgeving:**
   ```bash
   npm start
   ```

## 🔄 Ontwikkelproces

### Branching Strategie

- `main` - Productie-klare code
- `develop` - Integratie branch voor features
- `feature/beschrijving` - Nieuwe functies
- `bugfix/beschrijving` - Bug fixes
- `hotfix/beschrijving` - Kritieke productie fixes

### Workflow

1. Maak een nieuwe branch aan van `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/jouw-feature-naam
   ```

2. Maak je wijzigingen volgens de code stijl richtlijnen

3. Test je wijzigingen grondig:
   ```bash
   npm run lint
   npm run build
   ```

4. Commit je wijzigingen met een beschrijvend bericht

5. Push naar je fork en maak een pull request aan

## 📝 Code Stijl Richtlijnen

### Algemene Principes

- **Leesbaarheid**: Code moet gemakkelijk te lezen en begrijpen zijn
- **Consistentie**: Volg bestaande patronen in de codebase
- **Comments**: Voeg comments toe voor complexe logica, vooral voor beginners
- **Documentatie**: Update documentatie bij het toevoegen van functies

### JavaScript/React Richtlijnen

#### Bestand en Component Naamgeving
```javascript
// Components: PascalCase
const CalendarPage = () => { ... }

// Bestanden: PascalCase voor components, camelCase voor utilities
CalendarPage.jsx
apiService.js

// Variabelen en functies: camelCase
const userName = 'jan'
const handleUserClick = () => { ... }

// Constanten: UPPER_SNAKE_CASE
const API_BASE_URL = '/api'
```

#### Component Structuur
```javascript
/**
 * Component beschrijving
 * @param {Object} props - Component props
 * @returns {JSX.Element} - Component JSX
 */
function ComponentName({ prop1, prop2 }) {
  // ================================================================
  // HOOKS EN STATE
  // ================================================================
  
  const [state, setState] = useState(initialValue)
  
  // ================================================================
  // EFFECTS
  // ================================================================
  
  useEffect(() => {
    // Effect logica
  }, [dependencies])
  
  // ================================================================
  // EVENT HANDLERS
  // ================================================================
  
  const handleEvent = () => {
    // Handler logica
  }
  
  // ================================================================
  // RENDER
  // ================================================================
  
  return (
    <div>
      {/* Component JSX */}
    </div>
  )
}
```

#### Functie Documentatie
```javascript
/**
 * Functie beschrijving
 * @param {string} email - Gebruikers email adres
 * @param {string} password - Gebruikers wachtwoord
 * @returns {Promise<Object>} - Gebruikers gegevens
 * @throws {Error} - Wanneer login mislukt
 */
async function loginUser(email, password) {
  // Functie implementatie
}
```

### Backend Richtlijnen

#### API Endpoint Structuur
```javascript
/**
 * Endpoint beschrijving
 * Method: POST
 * Path: /api/endpoint
 * Body: { field1, field2 }
 * Returns: { success, data }
 */
app.post('/api/endpoint', async (req, res) => {
  try {
    // Validatie
    const { field1, field2 } = req.body
    if (!field1 || !field2) {
      return res.status(400).json({ msg: 'Verplichte velden ontbreken' })
    }
    
    // Bedrijfslogica
    const result = await processData(field1, field2)
    
    // Respons
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Endpoint fout:', error)
    res.status(500).json({ msg: 'Interne server fout' })
  }
})
```

### CSS Richtlijnen

#### Class Naamgeving (BEM-geïnspireerd)
```css
/* Component block */
.calendar-page { }

/* Component element */
.calendar-page__header { }

/* Component modifier */
.calendar-page__header--hidden { }

/* State classes */
.is-active, .is-hidden, .is-loading { }
```

#### CSS Structuur
```css
/* ================================================================
 * COMPONENT NAAM
 * ================================================================ */

.component-name {
  /* Layout eigenschappen */
  display: flex;
  position: relative;
  
  /* Box model */
  width: 100%;
  padding: 1rem;
  margin: 0.5rem;
  
  /* Typografie */
  font-size: 1rem;
  color: #333;
  
  /* Visueel */
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
}
```

## 📝 Commit Bericht Richtlijnen

### Format
```
type(scope): korte beschrijving

Gedetailleerde uitleg indien nodig

- Lijst specifieke wijzigingen
- Verwijs naar issues indien van toepassing

Sluit #123
```

### Types
- `feat`: Nieuwe functie
- `fix`: Bug fix
- `docs`: Documentatie wijzigingen
- `style`: Code stijl wijzigingen (formatting)
- `refactor`: Code refactoring
- `test`: Tests toevoegen
- `chore`: Onderhoudstaken

### Voorbeelden
```
feat(auth): voeg wachtwoord reset functionaliteit toe

- Voeg wachtwoord vergeten pagina toe
- Implementeer email verificatie systeem
- Voeg reset wachtwoord API endpoint toe

Sluit #45

fix(calendar): herstel event verwijdering bug

De delete knop verwijderde events niet correct
uit de kalender weergave na API call.

refactor(api): verbeter foutafhandeling

- Standaardiseer foutrespons formaat
- Voeg uitgebreide logging toe
- Verbeter input validatie
```

## 🔄 Pull Request Proces

### Voor Indienen

1. **Update documentatie** als je APIs hebt gewijzigd of functies hebt toegevoegd
2. **Voer linting uit** om code stijl compliance te garanderen
3. **Test grondig** in zowel ontwikkel als build modes
4. **Controleer op conflicten** met de main branch

### PR Beschrijving Template

```markdown
## Beschrijving
Korte beschrijving van wijzigingen

## Type Wijziging
- [ ] Bug fix
- [ ] Nieuwe functie
- [ ] Documentatie update
- [ ] Code refactoring

## Testen
- [ ] Lokaal getest
- [ ] Alle bestaande tests slagen
- [ ] Nieuwe tests toegevoegd indien van toepassing

## Screenshots (indien van toepassing)
Voeg screenshots toe voor UI wijzigingen

## Checklist
- [ ] Code volgt stijl richtlijnen
- [ ] Self-review voltooid
- [ ] Documentatie bijgewerkt
- [ ] Geen console fouten
```

### Review Proces

1. Code wordt beoordeeld door maintainers
2. Reageer op feedback of gevraagde wijzigingen
3. Zodra goedgekeurd, wordt je PR gemerged

## 🐛 Bug Rapportages

### Voor Rapporteren

1. **Zoek bestaande issues** om duplicaten te vermijden
2. **Probeer de laatste versie** om te zien of de bug al is opgelost
3. **Verzamel informatie** over je omgeving

### Bug Rapport Template

```markdown
## Bug Beschrijving
Duidelijke beschrijving van de bug

## Stappen om te Reproduceren
1. Ga naar '...'
2. Klik op '...'
3. Zie fout

## Verwacht Gedrag
Wat zou er moeten gebeuren

## Werkelijk Gedrag
Wat er werkelijk gebeurt

## Omgeving
- OS: [bijv., Windows 10]
- Node.js versie: [bijv., 18.0.0]
- Browser: [bijv., Chrome 91]

## Aanvullende Context
Screenshots, error logs, etc.
```

## 💡 Functieverzoeken

### Functieverzoek Template

```markdown
## Functie Beschrijving
Duidelijke beschrijving van de voorgestelde functie

## Probleem dat het Oplost
Welk probleem adresseert deze functie?

## Voorgestelde Oplossing
Hoe zou deze functie moeten werken?

## Overwogen Alternatieven
Andere oplossingen die je hebt overwogen

## Aanvullende Context
Mockups, voorbeelden, gerelateerde issues
```

## 📚 Bronnen

### Documentatie
- [React Documentatie](https://react.dev/)
- [Express.js Documentatie](https://expressjs.com/)
- [FullCalendar Documentatie](https://fullcalendar.io/docs)
- [Vite Documentatie](https://vitejs.dev/)

### Leer Bronnen
- [MDN Web Docs](https://developer.mozilla.org/)
- [JavaScript.info](https://javascript.info/)
- [React Tutorial](https://react.dev/learn)

## 🎯 Gebieden voor Bijdrage

### Hoge Prioriteit
- Database integratie (vervang JSON bestanden)
- Unit test coverage
- Mobiele responsiviteit verbeteringen
- Prestatie optimalisaties

### Gemiddelde Prioriteit
- Kalender themes/aanpassing
- Event categorieën en filtering
- Gebruikersprofiel beheer
- Email templates

### Lage Prioriteit
- Aanvullende kalender weergaven
- Import/export functionaliteit
- Notificatie systeem
- Meertalige ondersteuning

## ✅ Erkenning

Bijdragers worden erkend in:
- README.md bijdragers sectie
- Release notes voor significante bijdragen
- Speciale dank voor grote functies

## 📞 Hulp Krijgen

- **Vragen**: Maak een discussie thread aan
- **Issues**: Gebruik de issue tracker
- **Documentatie**: Controleer README.md en code comments

Bedankt voor het bijdragen aan de Stamjer Kalender Applicatie! 🎉
