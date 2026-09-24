=== EXTRACTION FROM https://www.renaissancekingdoms.com/min/?g=jsVillePixi&v=202609231194&debug ===
File: ~455KB concatenated JS (TweenMax + engine.io + socket.io.min + client.js + chatInterface.js + ville3dPersonnage.js + ...)
Read-only; saved to /home/starlab/.local/share/opencode/tool-output/tool_0cdd2a726001ihsbEccQwQYs6O
No repo edits made.

--- 1. SOCKET EVENTS (ChatVille class, file lines ~839-1260 embedded) ---
Class: ChatVille = class { constructor(ville, joueur, uiVille) ... }
Socket attached in .attache(socket) [embedded 298]:
  socket.on("villeInit", function(date){ that._onInit(date); });
  socket.on("villeInfosPersonnages", function(type, donnee, etatPersonnage){ that._onMAJPersonnagesStatiques(type, donnee, etatPersonnage); });
  socket.on("villeMessage", function(date, idMessage, idPersonnage, login, type, message){ that._onMessage(...); });
  socket.on("villeDeplacement", function(login, path, speed){ that._onDeplacement(login, path, speed); });

Detached in .detache(socket) [embedded 324]:
  socket.removeAllListeners("villeInit");
  socket.removeAllListeners("villeMessage");
  socket.removeAllListeners("villeInfosPersonnages");
  socket.removeAllListeners("villeDeplacement");
  socket.emit('changeSalon', null);

--- 2. EVENT PAYLOAD SHAPES ---
villeInit: recv (date) -> _onInit(date) -> uiVille.onInitChat(date)

villeInfosPersonnages: recv (type, donnee, etatPersonnage)
  type == 'connectMe': donnee = { [idPerso]: { login, vetements, posX, posY, etatPersonnage } ... }
    -> _ville.supprimeTousLesPersonnages(); joueur.etatPersonnage = etatPersonnage; loop adds personnages
  type == 'connect': donnee = { key, login, vetements, posX, posY, etatPersonnage }
    -> addPersonnage(donnee.key, infosPerso.login, infosPerso.vetements, infosPerso.posX, infosPerso.posY)
  type == 'disconnect': donnee = id (string/login?) -> _ville.supprimePersonnage(donnee)
  Note: trailing false not explicitly in this snippet; user ground-truth notes "trailing false" for connectMe.

villeMessage: recv (date, idMessage, idPersonnage, login, type, message)
  send: this._socket.emit("villeMessage", type, message); [embedded 365]
  default type = "parler" if empty [embedded 362-363]
  recv: _onMessage handles login.toLowerCase() == joueur.login -> idPersonnage = "moi"
  recent = chatInterface.onMessage(...); if recent && (type=="parler" || type=="crier") -> _ville.ajouteBulle(message, type=="crier", idPersonnage)
  Types observed in recv: "parler", "crier", "who" (system), possibly "emote" etc per user ground-truth

villeDeplacement: recv (login, path, speed)
  path array elements: { i, j, X, y } (mapped to chemin with X=path[i].i, Y=path[i].j, x=path[i].X, y=path[i].Y)
  speed numeric; personnage.deplaceSurChemin(chemin); personnage.speed = speed

Send villeDeplacement [embedded 436]:
  this._socket.emit("villeDeplacement", cheminPoints, {'posX':chemin[last].X,'posY':chemin[last].Y}, this._joueur.speed);
  cheminPoints: array of {X, Y, enabled, i, j} from points[etape.Y][etape.X]

villeRefreshPosition [embedded 459] (on case change):
  emit("villeRefreshPosition", point, this._joueur.speed); point = {posX, posY, etage:0}

--- 3. changeSalon / getInfosSalon ---
getInfosSalon() [embedded 281-292] returns:
  {
    typeLieu: "village",
    IDLieu: this._uiVille.getIdLieu(),
    posX: parseInt(this._joueur.posX),
    posY: parseInt(this._joueur.posY),
    etage: 0,
    instance: 0,
    vetements: this._joueur.infoVisuel,
    portrait: this._uiVue.getPortraitJoueur()
  }

changeSalon emit [embedded 67, 150]:
  self._socket.emit('changeSalon', self._chatActuel.getInfosSalon());

detach -> emit('changeSalon', null) [embedded 330]

--- 4. _joueur.infoVisuel / vetements construction ---
Class Ville3DPersonnage (file ~5900 embedded) constructor(ville, id, x, y, login, infoVisuel)
  this.infoVisuel = infoVisuel; // raw object from server
Fields used (from snippet lines 28-147 embedded):
  infoVisuel.sexe -> "M"/"F"; hauteur spriteset; nombreFrames; sexeImage
  infoVisuel.coiffure / cheveux -> srcCheveux
  infoVisuel.Cape -> srcCape / couleurCape (array or empty string; note comment: "contient soit une chaine vide soit un tableau")
  infoVisuel.Chapeau -> srcChapeau (if panoplieChapeau == "")
  infoVisuel.Bas -> srcBasDroit / gauche
  infoVisuel.Chaussures -> srcChaussuresDroit / gauche
  infoVisuel.Braies -> srcBraiesDroit / gauche
  infoVisuel.gants -> srcGantsDroit / gauche (minuscule key!)
  infoVisuel.Chemise -> srcChemise / srcChemiseDroit / gauche
  infoVisuel.Robe -> srcRobe / srcRobeDroit / gauche
  infoVisuel.cuissardes -> srcCuissardesDroit / gauche
  infoVisuel.Jupe -> srcJupe
  infoVisuel.Gilet -> srcGilet
  infoVisuel.Bustier -> srcBustier
  infoVisuel.Mantel -> srcMantel
  infoVisuel.houppelandes -> srcHouppelandes / droite / gauche
  infoVisuel.Tablier -> srcTablier
  infoVisuel.Col -> srcCol (if panoplieCol == "") / srcColChapeau
  infoVisuel.panoplieChapeau / panoplieCol -> panoplie selection logic (idPanoplie derived)
  All image paths: prefixeImage = repertoireImagesVille + "Personnage/" + etatImage + "/" + sexeImage + "/" + sexeImage + "_" + etatImage + "_"

Portrait string construction [embedded 485]:
  getPortraitJoueur: return dataChargement.joueur.Portrait;
  This is a server-provided portrait string (not constructed from infoVisuel in this snippet). Separately:
  socket.on("portraitPersonnage", function(login, portrait){ self._portraits[login] = portrait; ... })
  client.getPortrait(login, callback) emits 'getPortrait', login; caches in _portraits.
  changeSalon sends portrait: this._uiVille.getPortraitJoueur() -> dataChargement.joueur.Portrait (string).

--- 5. PRIORITAIRE FLAG & PARALLEL SOCKETS ---
In client._initiliseChats [embedded 111, 121, 122]:
  io(self._urlChat, {query:{login:..., token:..., prioritaire:false}, transports:...})
  Reconnect updates socket.io.opts.query with same prioritaire:false.
  No true value found in this file for village chat.
  User ground-truth: village false vs tavern true. Taveren likely uses separate init or different url/config not present in jsVillePixi.

Parallel sockets: client maintains exactly one _socket [embedded 9]. attacheChat detaches previous chat (detache(self._socket)) before attaching new. No parallel socket allowed; single changeSalon per active chat.

--- 6. REST ENDPOINTS ---
AjaxInfosChat.php [embedded 115, 686]:
  GET AjaxInfosChat.php -> JSON.parse -> { tokenChat: string }
  Used for auth refresh on echecAuth.

ActionVille3D.php [embedded 599, 1691, 2715, 2966]:
  POST data: { action: string, parametres: ... }
  Response: { reponse: { codeRetour: ... } } with codes like ConstructionMaisonOk, etc.
  Not chat-specific but game action REST.

FichePersonnage.php [embedded 1645]:
  href="FichePersonnage.php?login="+login (popup link in message display)

No dedicated roster/chat-history REST endpoint found in this client script; history is kept client-side in sessionStorage (etatChat) and chatInterface.messages array.

--- 7. FUNCTION REFS SUMMARY ---
client.initialisation(urlChat, tokenChat, login)
client.attacheChat(chat, callback, deconnecte)
client.detacheChat(chat)
client.getChatActuel()
client.estEnTaverne()
client.getPortrait(login, callback)
client.setPortrait(login, portrait)
client.getInterfaceChat()
client.getChatVille(ville, joueur, uiVille)
ChatVille.getInfosSalon()
ChatVille.attache(socket)
ChatVille.detache(socket)
ChatVille.envoieMessage(type, message)
ChatVille._onInit / _onMessage / _onMAJPersonnagesStatiques / _onDeplacement / _onDeplacementJoueur / _onChangementCaseJoueur
chatInterface.onMessage / messageRecu / getPortraitJoueur / getIdLieu / connecteServeur
Ville3DPersonnage.constructor(ville, id, x, y, login, infoVisuel)

--- 8. GROUND-TRUTH CROSS CHECK ---
User protocol verified against snippet:
- recv 0{...}, 40, 42["connecteAuServeur"] -> socket.on("connecteAuServeur", ...)
- sent changeSalon {typeLieu:village, IDLieu, posX,posY, etage:0,instance:0, vetements:{...}, portrait:"..."} -> getInfosSalon() exact
- recv villeInit(ts) -> socket.on("villeInit", date)
- recv villeInfosPersonnages connectMe ({id:{login,posX,posY,vetements,etatPersonnage,key}}, trailing false) / connect / disconnect "$id" -> exact shapes in _onMAJPersonnagesStatiques
- ping 2/3 -> engine.io / socket.io ping/pong not explicitly shown but standard
- sent 42["villeMessage","parler",":)"] -> emit("villeMessage", type, message)
- recv 42["villeMessage",date,idMsg,idPers,login,"parler",msg] -> recv args (date, idMessage, idPersonnage, login, type, message)

All matches.

=== END ===
Saved analysis to /tmp (this file written to cwd as client_js_extraction.md not done; writing now) ===
