# Stamjer Kalender Applicatie

Een professionele React + Vite gebaseerde kalender applicatie met gebruikersauthenticatie en evenementbeheer mogelijkheden. Gebouwd met FullCalendar voor kalenderfunctionaliteit en Express.js voor de backend API.

---

## 📋 Inhoudsopgave

- [Overzicht](#overzicht)
- [Functies](#functies)
- [Vereisten](#vereisten)
- [Installatie](#installatie)
- [Beschikbare Scripts](#beschikbare-scripts)
- [Projectstructuur](#projectstructuur)
- [Configuratie](#configuratie)
- [API Documentatie](#api-documentatie)
- [Ontwikkelgids](#ontwikkelgids)
- [Deployment](#deployment)

---

## 🎯 Overzicht

De Stamjer Kalender Applicatie is een volledige webapplicatie ontworpen voor het beheren van kalenderevenementen met gebruikersauthenticatie. Het biedt een schone, moderne interface voor het maken, bewerken en beheren van kalenderevenementen terwijl veilige gebruikerstoegang wordt gegarandeerd door middel van e-mailverificatie.

### Belangrijkste Technologieën

- **Frontend**: React 19, Vite, FullCalendar, React Router
- **Backend**: Node.js, Express.js, Nodemailer
- **Gegevensopslag**: JSON bestanden (eenvoudig te upgraden naar database)
- **Authenticatie**: E-mail gebaseerd verificatiesysteem
- **Styling**: CSS met moderne designprincipes

---

## ✨ Functies

### 🔐 Authenticatiesysteem
- Gebruikersregistratie met e-mailverificatie
- Veilige login/logout functionaliteit
- Wachtwoord reset met e-mailverificatiecodes
- Beveiligde routes voor geauthenticeerde gebruikers

### 📅 Kalenderbeheer
- Kalenderevenementen bekijken in maand/dag raster
- Nieuwe evenementen maken met details (titel, datum, tijd, locatie, beschrijving)
- Bestaande evenementen bewerken
- Evenementen verwijderen
- Ondersteuning voor hele dag en getimede evenementen

### 🛡️ Beveiligingsfuncties
- E-mail domein validatie
- Verificatiecodes met vervaldatum
- CORS bescherming
- Input validatie en sanitisatie

### 📱 Gebruikerservaring
- Responsief ontwerp
- Nederlandse lokalisatie
- Intuïtieve modal-gebaseerde interfaces
- Realtime feedback en foutafhandeling

---

## 📋 Vereisten

Voordat je begint, zorg ervoor dat je het volgende hebt geïnstalleerd:

- **Node.js** v16 of hoger ([Download hier](https://nodejs.org/))
- **npm** (komt met Node.js)
- **Git** (voor versiebeheer)

---

## 🚀 Installatie

1. **Kloon de repository:**
   ```bash
   git clone <repository-url> stamjer-kalender
   cd stamjer-kalender
   ```

2. **Installeer dependencies:**
   ```bash
   npm install
   ```

3. **Stel omgevingsvariabelen in:**
   Maak een `.env` bestand in de hoofdmap:
   ```env
   # Email Configuratie (Optioneel - gebruikt test emails indien niet ingesteld)
   SMTP_SERVICE=gmail
   SMTP_USER=jouw-email@gmail.com
   SMTP_PASS=jouw-app-wachtwoord
   SMTP_FROM=noreply@jouwdomein.com
   
   # Server Configuratie
   PORT=3002
   NODE_ENV=development
   ```

4. **Initialiseer gegevensbestanden:**
   De applicatie zal automatisch `data/users.json` en `data/events.json` aanmaken bij de eerste uitvoering.

---

## 📜 Beschikbare Scripts

### Ontwikkeling
- **`npm run dev`**: Start de Vite ontwikkelserver (frontend)
- **`npm run serve-api`**: Start de Express API server (backend)
- **`npm start`**: Start zowel frontend als backend tegelijkertijd

### Productie
- **`npm run build`**: Bouw de applicatie voor productie
- **`npm run preview`**: Bekijk de productieversie

### Hulpprogramma's
- **`npm run lint`**: Voer ESLint uit om codekwaliteit te controleren
- **`npm run serve-events`**: Start JSON server voor evenementen (ontwikkeling)

### Aanbevolen Ontwikkelworkflow
```bash
# Start zowel frontend als backend
npm start
```
Dit zal het volgende starten:
- Frontend ontwikkelserver op `http://localhost:5173`
- Backend API server op `http://localhost:3002`

---

## 📁 Projectstructuur

```
stamjer-kalender/
├── data/                    # Gegevensopslag (JSON bestanden)
│   ├── events.json         # Kalenderevenementen gegevens
│   └── users.json          # Gebruikersaccounts gegevens
├── public/                 # Statische assets
│   ├── stam_H.png         # Applicatie logo
│   └── vite.svg           # Vite logo
├── src/                   # Frontend broncode
│   ├── assets/            # Statische assets
│   ├── components/        # Herbruikbare React componenten
│   │   └── ProtectedRoute.jsx  # Route bescherming component
│   ├── pages/             # Pagina componenten
│   │   ├── Auth.css       # Authenticatie pagina styles
│   │   ├── CalendarPage.css    # Kalender pagina styles
│   │   ├── CalendarPage.jsx    # Hoofd kalender interface
│   │   ├── ForgotPassword.jsx  # Wachtwoord reset pagina
│   │   ├── Login.jsx      # Login pagina
│   │   ├── MyAccount.jsx  # Gebruikersaccount pagina
│   │   └── Register.jsx   # Registratie pagina
│   ├── services/          # API service laag
│   │   └── api.js         # API communicatie functies
│   ├── App.css           # Globale applicatie styles
│   ├── App.jsx           # Hoofd applicatie component
│   ├── index.css         # Globale CSS styles
│   └── main.jsx          # Applicatie startpunt
├── server.js             # Backend Express server
├── package.json          # Project dependencies en scripts
├── vite.config.js        # Vite configuratie
├── eslint.config.js      # ESLint configuratie
└── README.md            # Dit bestand
```

---

## ⚙️ Configuratie

### Omgevingsvariabelen

Maak een `.env` bestand in de hoofdmap om de applicatie te configureren:

```env
# Email Configuratie (voor productie)
SMTP_SERVICE=gmail                    # Email service provider
SMTP_USER=jouw-email@gmail.com        # Email account gebruikersnaam
SMTP_PASS=jouw-app-wachtwoord         # App-specifiek wachtwoord
SMTP_FROM=noreply@jouwdomein.com      # Van email adres

# Server Configuratie
PORT=3002                             # Backend server poort
NODE_ENV=development                  # Omgeving (development/production)
```

### Email Setup

Voor productie email functionaliteit:

1. **Gmail Setup:**
   - Schakel 2-factor authenticatie in
   - Genereer een app-specifiek wachtwoord
   - Gebruik het app wachtwoord in `SMTP_PASS`

2. **Andere Providers:**
   - Configureer `SMTP_SERVICE` volgens Nodemailer documentatie
   - Pas instellingen aan zoals nodig voor je provider

### Ontwikkelmodus

Als er geen email configuratie is ingesteld, gebruikt de applicatie Ethereal Email voor testen. Controleer de console voor preview links wanneer emails worden verstuurd.

---

## 📡 API Documentatie

### Authenticatie Endpoints

#### POST /register
Registreer een nieuwe gebruiker (stap 1).
```json
{
  "firstName": "Jan",
  "lastName": "Jansen",
  "email": "jan@voorbeeld.com",
  "password": "wachtwoord123"
}
```

#### POST /verify
Voltooi registratie met verificatiecode (stap 2).
```json
{
  "email": "jan@voorbeeld.com",
  "code": "123456"
}
```

#### POST /login
Gebruiker login.
```json
{
  "email": "jan@voorbeeld.com",
  "password": "wachtwoord123"
}
```

#### POST /forgot-password
Vraag wachtwoord reset code aan.
```json
{
  "email": "jan@voorbeeld.com"
}
```

#### POST /reset-password
Reset wachtwoord met verificatiecode.
```json
{
  "email": "jan@voorbeeld.com",
  "code": "123456",
  "password": "nieuwwachtwoord123"
}
```

### Evenement Endpoints

#### GET /events
Krijg alle kalenderevenementen.

#### POST /events
Maak een nieuw evenement.
```json
{
  "title": "Vergadering",
  "start": "2024-01-15",
  "end": "2024-01-15",
  "allDay": true,
  "location": "Kantoor",
  "description": "Teamvergadering"
}
```

#### PUT /events/:id
Werk een bestaand evenement bij.

#### DELETE /events/:id
Verwijder een evenement.

---

## 🛠️ Ontwikkelgids

### Code Structuur

De applicatie volgt een modulaire architectuur:

1. **Frontend (React)**
   - Componenten zijn georganiseerd op doel (pagina's, componenten, services)
   - State management met React hooks
   - API calls gecentraliseerd in `services/api.js`

2. **Backend (Express)**
   - RESTful API ontwerp
   - Middleware voor CORS, logging en validatie
   - Bestandsgebaseerde gegevensopslag (eenvoudig vervangbaar met database)

### Belangrijke Componenten

#### Frontend Componenten

- **App.jsx**: Hoofd applicatie router en navigatie
- **CalendarPage.jsx**: Volledige kalender interface met evenementbeheer
- **ProtectedRoute.jsx**: Route bescherming voor geauthenticeerde gebruikers
- **api.js**: Gecentraliseerde API communicatie laag

#### Backend Functies

- **Authenticatie**: E-mail gebaseerd verificatiesysteem
- **Gegevensopslag**: JSON bestand opslag met asynchrone operaties
- **Email Service**: Nodemailer integratie met fallback naar test emails
- **Foutafhandeling**: Uitgebreide foutlogboeken en gebruikersfeedback

### Nieuwe Functies Toevoegen

1. **Nieuw API Endpoint:**
   - Voeg route handler toe in `server.js`
   - Voeg bijbehorende functie toe in `src/services/api.js`
   - Update API documentatie

2. **Nieuw React Component:**
   - Maak component in juiste map
   - Voeg benodigde imports en exports toe
   - Include juiste documentatie

3. **Nieuwe Pagina:**
   - Maak pagina component in `src/pages/`
   - Voeg route toe in `App.jsx`
   - Update navigatie indien nodig

---

## 🚀 Deployment

### Ontwikkel Deployment

1. **Start ontwikkel servers:**
   ```bash
   npm start
   ```

2. **Toegang tot de applicatie:**
   - Frontend: `http://localhost:5173`
   - Backend API: `http://localhost:3002`

### Productie Deployment

1. **Bouw de frontend:**
   ```bash
   npm run build
   ```

2. **Stel omgevingsvariabelen in:**
   ```bash
   export NODE_ENV=production
   export PORT=3002
   # Stel email configuratie variabelen in
   ```

3. **Start de productie server:**
   ```bash
   npm run serve-api
   ```

4. **Server statische bestanden:**
   Configureer je web server (nginx, Apache) om de `dist/` map te serveren en API verzoeken door te sturen naar de Node.js server.

### Productie Overwegingen

- Stel juiste email service configuratie in
- Gebruik een echte database in plaats van JSON bestanden voor grotere applicaties
- Implementeer juiste logging en monitoring
- Stel SSL/TLS certificaten in
- Configureer juiste backup procedures voor gegevensbestanden

---

## 🤝 Bijdragen

1. Fork de repository
2. Maak een feature branch (`git checkout -b feature/geweldige-functie`)
3. Commit je wijzigingen (`git commit -m 'Voeg geweldige functie toe'`)
4. Push naar de branch (`git push origin feature/geweldige-functie`)
5. Open een Pull Request

### Code Stijl

- Volg de bestaande ESLint configuratie
- Gebruik betekenisvolle component en variabele namen
- Voeg comments toe voor complexe logica
- Volg React best practices
- Handhaaf consistente bestandsstructuur

---

## 📝 Licentie

Dit project is gelicentieerd onder de MIT Licentie - zie het LICENSE bestand voor details.

---

## 📞 Support

Voor support en vragen:

1. Controleer de documentatie hierboven
2. Bekijk de code comments voor implementatiedetails
3. Maak een issue aan in de repository voor bugs of feature verzoeken

---

## 🏆 Erkenningen

- **FullCalendar** voor het excellente kalender component
- **React** en **Vite** voor het frontend framework en build tools
- **Express.js** voor het backend framework
- **Nodemailer** voor email functionaliteit

---

*Gebouwd met ❤️ door het Stamjer Development Team*
