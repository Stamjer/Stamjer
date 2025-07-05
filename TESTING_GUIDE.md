# Testen van de Actieve Status Functie

## Stap 1: Start de Server
1. Open een terminal
2. Navigeer naar de projectmap
3. Voer uit: `node server.js`
4. De server zou moeten starten op poort 3002

## Stap 2: Test het API Endpoint
1. Open het `test-active-status.html` bestand in een browser
2. Of gebruik curl:
   ```bash
   curl -X PUT http://localhost:3002/api/user/profile \
     -H "Content-Type: application/json" \
     -d '{"userId": 1, "active": false}'
   ```

## Stap 3: Test de Frontend
1. Start de Vite ontwikkelserver: `npm run dev`
2. Log in met gebruikersgegevens
3. Ga naar de MyAccount pagina
4. Probeer het "Actief" selectievakje te wijzigen

## Veelvoorkomende Problemen:

### 1. Gebruikers ID Ontbreekt
- Zorg ervoor dat je bent ingelogd met een gebruiker die een `id` veld heeft
- Controleer de browser console voor gebruikersgegevens

### 2. Server Draait Niet
- Zorg ervoor dat de server draait op poort 3002
- Controleer op server opstartfouten

### 3. CORS Problemen
- De server heeft CORS ingeschakeld, maar zorg dat het correct is geconfigureerd
- Controleer browser developer tools voor CORS fouten

### 4. API Endpoint Pad
- Het endpoint is: `PUT /api/user/profile`
- Zorg dat de basis URL correct is

## Debug Stappen:

1. **Controleer Gebruikersgegevens in Browser:**
   - Open Developer Tools (F12)
   - Ga naar Application/Storage tab
   - Controleer localStorage voor 'user' sleutel
   - Verifieer dat het gebruikersobject een 'id' veld heeft

2. **Controleer Server Logs:**
   - Kijk naar debug berichten in de server console
   - Controleer of het API verzoek wordt ontvangen

3. **Controleer Network Tab:**
   - Open Developer Tools
   - Ga naar Network tab
   - Probeer de actieve status bij te werken
   - Controleer of de API call wordt gemaakt en welke respons wordt ontvangen

## Verwacht Gedrag:
- Wanneer je het selectievakje wijzigt, zou het moeten:
  1. Een loading state tonen
  2. Een API call maken om de server bij te werken
  3. Het users.json bestand bijwerken
  4. Een succesbericht tonen
  5. De localStorage bijwerken met de nieuwe actieve status
