// RK Midas character renderer, ported to a self-contained ES module.
// Vendored from Renaissance Kingdoms' midas.js (via rk_chat's port) and
// adjusted for Estaminet:
// - CDN root points at the oxv CDN directly (lesroyaumes.cdn.oxv.fr serves
//   Access-Control-Allow-Origin: *). renaissancekingdoms.com 302-redirects
//   there WITHOUT ACAO on the redirect hop — a CORS-mode <img> load
//   (crossOrigin="anonymous", needed for toDataURL) fails its CORS check on
//   that hop and every calque errors out, leaving a blank canvas. Verified
//   2026-09: 302 has no ACAO, final CDN response has ACAO:*.
// - Resolution is fixed at _@1X (parity with the previous live renderer).
// - No `window.RAR` global: all state lives in this module.
// - Added Midas.genereCanvasDepuisJSON: Promise-based OFFSCREEN renderer —
//   the canvas never needs DOM attachment, sidestepping the WebKitGTK
//   canvas-repaint bugs (267986/218292) that made live avatars vanish.

import { MIDAS_CDN } from "../config";

const RACINE_IMAGES_CDN = MIDAS_CDN;
interface MidasItem {
  nom: string;
  slot: string;
  declinaison?: string | number | null;
  dependCouleurPeau?: boolean;
  dependPostureMainG?: boolean;
  dependPostureMainD?: boolean;
  postureMainG?: number | null;
  postureMainD?: number | null;
  zIndexCalques?: string[];
  slotsMasques?: string[];
}

interface MidasAlteration {
  Type: string;
  Value: string;
}

declare global {
  interface CanvasRenderingContext2D {
    midasResolution?: number;
  }
}

interface MidasContexte {
  login: string;
  sexe: string;
  alterationsMidas: MidasAlteration[];
  portraitPersonnalise: boolean;
  visage: number;
  couleurPeau: number;
  marques: number;
  sourcils: number;
  couleurSourcils: number;
  yeux: number;
  couleurYeux: number;
  nez: number;
  bouche: number;
  couleurBouche: number;
  cheveux: number;
  couleurCheveux: number;
  barbe: number;
  couleurBarbe: number;
  emotions: {
    sourcils: number;
    yeux: number;
    iris: number;
    nez: number;
    bouche: number;
    barbe: number;
  };
  postureMainG: number;
  postureMainD: number;
  slotsMasques: Record<string, string>;
  format: string | null;
  resolution: string;
}

interface Calque {
  src: string;
  zIndex: number;
  tag: string;
  posX: number;
  posY: number;
  img?: HTMLImageElement;
  ok?: boolean;
}

const SLOTS = {
  mainD: { nom: "MainD", zIndex: [2002, 2003] },
  mainG: { nom: "MainG", zIndex: [14000, 17001] },
  sousVetements: { nom: "SousVetements", zIndex: 2003 },
  visage: { nom: "Visage", zIndex: 7200 },
  cheveuxAvants: { nom: "CheveuxAvants", zIndex: 10000 },
  cheveuxIntermediaires: { nom: "CheveuxIntermediaires", zIndex: 7000 },
  cheveuxArrieres: { nom: "CheveuxArrieres", zIndex: 1500 },
  barbes: { nom: "Barbes", zIndex: 10001 },
  corps: { nom: "Corps", zIndex: 2000 },
  cheveux: { nom: "Cheveux", zIndex: 10000 },
  personnage: { nom: "Personnage", zIndex: 20000 },
  ombre: { nom: "Ombre", zIndex: 10 },
};

const NB_CALQUES_MAIN: Record<string, Record<number, number>> = {
  MainD: {},
  MainG: { 1: 2 },
};

const CHANGE_SIZE_EXCLUDED_SLOTS = ["Familier", "Fond", "Cadre"];
const SKIN_SLOTS = ["corps", "visage", "cheveux"];
const HAIR_SLOTS = ["cheveux"];
const SLOTS_GARDE_ROBE = { BARBES: "Barbes", COIFFURES: "Coiffures" };

// Module-local renderer state (replaces the old global RAR.Midas object).
const state = {
  format: null as string | null,
  resolution: "_@1X",
  racine: RACINE_IMAGES_CDN + "personnages_midas/",
};

function readLocalStorage(key: string): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}

function error(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error(...args);
}

class ListeCalque {
  private _calques: Calque[] = [];
  private _onLoad: () => void = () => {};

  ajouteCalque(src: string, zIndex: number, tag: string, posX = 0, posY = 0): void {
    this._calques.push({ src, zIndex, tag, posX, posY });
  }

  genereCanvas(infosContexte: MidasContexte): Promise<HTMLCanvasElement> {
    let resolution: number;
    if (infosContexte.resolution === "_@4X") resolution = 4;
    else if (infosContexte.resolution === "_@2X") resolution = 2;
    else resolution = 1;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    canvas.classList.add("apercu_personnage_rar__calque");
    canvas.width = resolution * 256;
    canvas.height = resolution * 512;
    context.midasResolution = resolution;
    return this.dessineCanvas(canvas, context, infosContexte);
  }

  dessineCanvas(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    infosContexte: MidasContexte,
  ): Promise<HTMLCanvasElement> {
    this._calques.sort((a, b) => a.zIndex - b.zIndex);

    const promises: Promise<void>[] = [];
    for (const calque of this._calques) {
      promises.push(
        new Promise<void>((accept) => {
          calque.img = document.createElement("img");
          // Keep the canvas untainted so the avatar can be captured to a PNG
          // (the RK CDN serves Access-Control-Allow-Origin: *).
          calque.img.crossOrigin = "anonymous";
          calque.img.onerror = () => {
            calque.ok = false;
            accept();
          };
          calque.img.onload = () => {
            calque.ok = true;
            accept();
          };
          calque.img.src = calque.src;
        }),
      );
    }
    let promise: Promise<unknown> = Promise.all(promises);

    promise = promise.then(() => this._onLoad());

    promise = promise.then(() => {
      for (const calque of this._calques) {
        if (!calque.ok) continue;
        let tailleModificateur = 1;
        context.filter = "none";

        for (const alteration of infosContexte.alterationsMidas) {
          switch (alteration.Type) {
            case "changeSize":
              if (!CHANGE_SIZE_EXCLUDED_SLOTS.includes(calque.tag))
                tailleModificateur = Number(alteration.Value);
              break;
            case "changeSkinColor":
              if (SKIN_SLOTS.includes(calque.tag)) {
                if (alteration.Value === "green")
                  context.filter = "contrast(1.1) sepia(1) hue-rotate(1500deg)";
                else if (alteration.Value === "blue")
                  context.filter = "contrast(1.1) sepia(1) hue-rotate(150deg)";
              }
              break;
            case "changeHairColor":
              if (HAIR_SLOTS.includes(calque.tag)) {
                if (alteration.Value === "green")
                  context.filter = "contrast(1.1) sepia(1) hue-rotate(1500deg) brightness(0.6)";
              }
              break;
            case "grayscale":
              if (["Fond", "Cadre"].includes(calque.tag)) context.filter = "grayscale(1)";
              break;
          }
        }

        const newWidth = canvas.width * tailleModificateur;
        const newHeight = canvas.height * tailleModificateur;
        const posX = (canvas.width - newWidth) * 0.5 + calque.posX * (context.midasResolution as number);
        const posY = canvas.height - newHeight + calque.posY * (context.midasResolution as number);
        context.drawImage(calque.img!, posX, posY, newWidth, newHeight);
      }
    });

    promise.catch((e) => error(e));
    return promise.then(() => canvas);
  }

  setOnLoad(callback: () => void): void {
    this._onLoad = callback;
  }

  getCalquesAvecTag(tag: string): Calque[] {
    return this._calques.filter((c) => c.tag === tag);
  }

  desactiveCalquesAvecTag(tag: string): void {
    for (const calque of this._calques) {
      if (calque.tag === tag) calque.ok = false;
    }
  }
}

class Midas {
  /** Full DOM path (kept as safety fallback): builds the racine div and
   * appends the canvas asynchronously when done. */
  static genereApercuDepuisJSON(
    json: string,
    mini = false,
    slotsMasques: string[] = [],
    resolution: string | null = null,
  ): HTMLDivElement {
    const racine = document.createElement("div");
    racine.classList.add("apercu_personnage_rar");
    if (mini) racine.classList.add("apercu_personnage_rar__mini");
    const infosApercu = this._parseJSON(json);
    if (infosApercu.sexe === "M") racine.classList.add("apercu_personnage_rar__homme");
    else racine.classList.add("apercu_personnage_rar__femme");

    this.genereCanvasDepuisJSON(json, slotsMasques, resolution)
      .then((resultat) => {
        if (!resultat) return;
        racine.appendChild(resultat.canvas);
        racine.classList.add("apercu_personnage_rar__affiche");
      })
      .catch((e) => error(e));
    return racine;
  }

  private static _parseJSON(json: string): any {
    const infosApercu = {
      login: "",
      sexe: "M",
      codeVisage: "M00000000000000000000",
      equipement: [] as MidasItem[],
      alterationsMidas: [] as MidasAlteration[],
    };
    try {
      return JSON.parse(json);
    } catch (e) {
      error(e, json);
      return infosApercu;
    }
  }

  /** Offscreen renderer: parses the portrait JSON, loads/draws every calque
   * on a detached canvas (never appended to the DOM) and resolves with it —
   * or null on failure. `sexe` lets the caller build the racine div classes
   * (__homme/__femme) that drive the CSS cropping offsets. */
  static genereCanvasDepuisJSON(
    json: string,
    slotsMasques: string[] = [],
    resolution: string | null = null,
  ): Promise<{ canvas: HTMLCanvasElement; sexe: string } | null> {
    const infosApercu = this._parseJSON(json);
    const sexe = infosApercu.sexe === "M" ? "M" : "F";
    const contexte = this._genereContexte(
      infosApercu.login,
      infosApercu.sexe,
      infosApercu.codeVisage,
      infosApercu.equipement,
      infosApercu.alterationsMidas,
    );
    const listeCalque = new ListeCalque();

    return this._getFormat()
      .then((format) => {
        contexte.format = format;
        contexte.resolution = resolution || state.resolution;
        for (const slotAMasquer of slotsMasques) contexte.slotsMasques[slotAMasquer] = slotAMasquer;
      })
      .then(() => {
        this._genereCorps(listeCalque, contexte);
        for (const item of infosApercu.equipement) this._genereEquipement(listeCalque, contexte, item);
        return listeCalque.genereCanvas(contexte);
      })
      .then((canvas) => ({ canvas, sexe }))
      .catch((e) => {
        error(e);
        return null;
      });
  }

  private static _genereCorps(listeCalque: ListeCalque, contexte: MidasContexte): void {
    if (contexte.slotsMasques[SLOTS.personnage.nom]) return;

    const racineImages = this._getRacineImages(contexte.sexe) + "corps/";

    if (!contexte.slotsMasques[SLOTS.mainG.nom]) {
      const posture = contexte.postureMainG;
      const nbCalques = NB_CALQUES_MAIN[SLOTS.mainG.nom][posture] ?? 1;
      if (nbCalques > 1) {
        for (let i = 0; i < nbCalques; i++) {
          listeCalque.ajouteCalque(
            `${racineImages}mainGauche_p${contexte.couleurPeau}_m${contexte.postureMainG}_${i}${contexte.resolution}.${contexte.format}`,
            SLOTS.mainG.zIndex[i],
            "corps",
          );
        }
      } else {
        listeCalque.ajouteCalque(
          `${racineImages}mainGauche_p${contexte.couleurPeau}_m${contexte.postureMainG}${contexte.resolution}.${contexte.format}`,
          SLOTS.mainG.zIndex[0],
          "corps",
        );
      }
    }
    if (!contexte.slotsMasques[SLOTS.mainD.nom]) {
      const posture = contexte.postureMainD;
      const nbCalques = NB_CALQUES_MAIN[SLOTS.mainD.nom][posture] ?? 1;
      if (nbCalques > 1) {
        for (let i = 0; i < nbCalques; i++) {
          listeCalque.ajouteCalque(
            `${racineImages}mainDroite_p${contexte.couleurPeau}_m${contexte.postureMainD}_${i}${contexte.resolution}.${contexte.format}`,
            SLOTS.mainD.zIndex[i],
            "corps",
          );
        }
      } else {
        listeCalque.ajouteCalque(
          `${racineImages}mainDroite_p${contexte.couleurPeau}_m${contexte.postureMainD}${contexte.resolution}.${contexte.format}`,
          SLOTS.mainD.zIndex[0],
          "corps",
        );
      }
    }
    if (!contexte.slotsMasques[SLOTS.cheveuxAvants.nom] && !contexte.slotsMasques[SLOTS.cheveux.nom])
      listeCalque.ajouteCalque(
        `${racineImages}cheveuxAvants_${contexte.cheveux}_c${contexte.couleurCheveux}${contexte.resolution}.${contexte.format}`,
        SLOTS.cheveuxAvants.zIndex,
        "cheveux",
      );
    if (!contexte.slotsMasques[SLOTS.visage.nom]) {
      listeCalque.ajouteCalque(
        `${racineImages}marques_${contexte.marques}_p${contexte.couleurPeau}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 6,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}sourcils_${contexte.sourcils}_c${contexte.couleurSourcils}_e${contexte.emotions.sourcils}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 5,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}yeux_${contexte.yeux}_p${contexte.couleurPeau}_e${contexte.emotions.yeux}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 4,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}iris_0_c${contexte.couleurYeux}_e${contexte.emotions.iris}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 3,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}nez_${contexte.nez}_p${contexte.couleurPeau}_e${contexte.emotions.nez}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 2,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}bouche_${contexte.bouche}_c${contexte.couleurBouche}_p${contexte.couleurPeau}_e${contexte.emotions.bouche}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex + 1,
        "visage",
      );
      listeCalque.ajouteCalque(
        `${racineImages}visage_${contexte.visage}_p${contexte.couleurPeau}${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex,
        "visage",
      );
    }
    if (!contexte.slotsMasques[SLOTS.sousVetements.nom])
      listeCalque.ajouteCalque(
        `${racineImages}sousVetements${contexte.resolution}.${contexte.format}`,
        SLOTS.sousVetements.zIndex,
        "corps",
      );
    if (!contexte.slotsMasques[SLOTS.corps.nom])
      listeCalque.ajouteCalque(
        `${racineImages}corps_p${contexte.couleurPeau}${contexte.resolution}.${contexte.format}`,
        SLOTS.corps.zIndex,
        "corps",
      );
    if (!contexte.slotsMasques[SLOTS.ombre.nom])
      listeCalque.ajouteCalque(
        `${racineImages}ombre${contexte.resolution}.${contexte.format}`,
        SLOTS.ombre.zIndex,
        "corps",
      );

    if (contexte.portraitPersonnalise && contexte.login) {
      listeCalque.ajouteCalque(
        `${state.racine}/portraitsPersonnalises/${contexte.login}_0${contexte.resolution}.${contexte.format}`,
        SLOTS.cheveuxArrieres.zIndex,
        "visagePersonnalise",
      );
      listeCalque.ajouteCalque(
        `${state.racine}/portraitsPersonnalises/${contexte.login}_1${contexte.resolution}.${contexte.format}`,
        SLOTS.visage.zIndex,
        "visagePersonnalise",
      );
      listeCalque.setOnLoad(() => {
        const calquesVisagePerso = listeCalque.getCalquesAvecTag("visagePersonnalise");
        const ok = calquesVisagePerso.every((c) => c.ok);
        if (ok) listeCalque.desactiveCalquesAvecTag("visage");
        else listeCalque.desactiveCalquesAvecTag("visagePersonnalise");
      });
    }
  }

  private static _genereEquipement(listeCalque: ListeCalque, contexte: MidasContexte, item: MidasItem): void {
    if (contexte.slotsMasques[item.slot]) return;

    if (item.slot === SLOTS_GARDE_ROBE.COIFFURES) {
      const racineImages = this._getRacineImages(contexte.sexe) + "corps/";
      const idCoiffure = item.nom.replace(/\D/g, "");
      if (!contexte.slotsMasques[SLOTS.cheveuxAvants.nom] && !contexte.slotsMasques[SLOTS.cheveux.nom])
        listeCalque.ajouteCalque(
          `${racineImages}cheveuxAvants_${idCoiffure}_c${contexte.couleurCheveux}${contexte.resolution}.${contexte.format}`,
          SLOTS.cheveuxAvants.zIndex,
          "cheveux",
        );
      if (!contexte.slotsMasques[SLOTS.cheveuxIntermediaires.nom] && !contexte.slotsMasques[SLOTS.cheveux.nom])
        listeCalque.ajouteCalque(
          `${racineImages}cheveuxIntermediaires_${idCoiffure}_c${contexte.couleurCheveux}${contexte.resolution}.${contexte.format}`,
          SLOTS.cheveuxIntermediaires.zIndex,
          "cheveux",
        );
      if (!contexte.slotsMasques[SLOTS.cheveuxArrieres.nom] && !contexte.slotsMasques[SLOTS.cheveux.nom])
        listeCalque.ajouteCalque(
          `${racineImages}cheveuxArrieres_${idCoiffure}_c${contexte.couleurCheveux}${contexte.resolution}.${contexte.format}`,
          SLOTS.cheveuxArrieres.zIndex,
          "cheveux",
        );
    } else if (item.slot === SLOTS_GARDE_ROBE.BARBES) {
      const matches = item.nom.match(/\d+/g);
      if (!matches) return;
      const nums = matches.map(Number);
      const idBarbe = nums[0];
      const expression = nums[1] || 0;
      if (!contexte.slotsMasques[SLOTS.visage.nom] && idBarbe > 0) {
        const racineImagesBarbe = `${this._getRacineImages()}hommes/corps/`;
        let calqueBarbePosX = 0;
        let calqueBarbePosY = 0;
        if (contexte.sexe === "F") {
          calqueBarbePosX = 7;
          calqueBarbePosY = 21;
        }
        listeCalque.ajouteCalque(
          `${racineImagesBarbe}barbe_${idBarbe}_c${contexte.couleurBarbe}_e${expression}${contexte.resolution}.${contexte.format}`,
          SLOTS.barbes.zIndex + 7,
          "visage",
          calqueBarbePosX,
          calqueBarbePosY,
        );
      }
    } else {
      for (let i = 0; i < (item.zIndexCalques?.length ?? 0); i++) {
        const zIndex = Number(item.zIndexCalques![i]);
        const src = this._getSrcEquipement(contexte, item, i);
        listeCalque.ajouteCalque(src, zIndex, item.slot);
      }
    }
  }

  private static _getRacineImages(sexe: string | null = null): string {
    let racineImages = state.racine;
    if (!sexe) return racineImages;
    racineImages += sexe === "F" ? "femmes/" : "hommes/";
    return racineImages;
  }

  private static _genereContexte(
    login: string,
    sexe: string,
    codeVisage: string,
    items: MidasItem[],
    alterationsMidas: MidasAlteration[] = [],
  ): MidasContexte {
    const contexte: MidasContexte = {
      login: login.toLowerCase(),
      sexe,
      alterationsMidas,
      portraitPersonnalise: codeVisage[0] === "P",
      visage: Number(codeVisage[1]) || 0,
      couleurPeau: Number(codeVisage[2]) || 0,
      marques: Number(codeVisage[3]) || 0,
      sourcils: Number(codeVisage[4]) || 0,
      couleurSourcils: Number(codeVisage[5]) || 0,
      yeux: Number(codeVisage[6]) || 0,
      couleurYeux: Number(codeVisage[7]) || 0,
      nez: Number(codeVisage[8]) || 0,
      bouche: Number(codeVisage[9]) || 0,
      couleurBouche: Number(codeVisage[10]) || 0,
      cheveux: Number(codeVisage[11]) || 0,
      couleurCheveux: Number(codeVisage[12]) || 0,
      barbe: Number(codeVisage[13]) || 0,
      couleurBarbe: Number(codeVisage[14]) || 0,
      emotions: {
        sourcils: Number(codeVisage[15]) || 0,
        yeux: Number(codeVisage[16]) || 0,
        iris: Number(codeVisage[17]) || 0,
        nez: Number(codeVisage[18]) || 0,
        bouche: Number(codeVisage[19]) || 0,
        barbe: Number(codeVisage[20]) || 0,
      },
      postureMainG: 0,
      postureMainD: 0,
      slotsMasques: {},
      format: state.format,
      resolution: state.resolution,
    };

    for (const item of items) {
      if (item.postureMainG != null && item.postureMainG !== 0) contexte.postureMainG = item.postureMainG;
      if (item.postureMainD != null && item.postureMainD !== 0) contexte.postureMainD = item.postureMainD;
      for (const slot of item.slotsMasques ?? []) {
        const correspondances = slot.match(/([MF]_)(.*)/);
        if (correspondances) {
          if (correspondances[1] === sexe + "_") contexte.slotsMasques[correspondances[2]] = correspondances[2];
        } else {
          contexte.slotsMasques[slot] = slot;
        }
      }
    }
    return contexte;
  }

  private static _getFormat(): Promise<string> {
    if (state.format != null) return Promise.resolve(state.format);
    return new Promise<string>((resolve) => {
      const kTestImages = {
        alpha:
          "UklGRkoAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggGAAAABQBAJ0BKgEAAQAAAP4AAA3AAP7mtQAAAA==",
      };
      const img = new Image();
      img.onload = () => {
        if (img.width > 0 && img.height > 0) {
          this._setFormat("webp");
          resolve("webp");
        } else {
          this._setFormat("png");
          resolve("png");
        }
      };
      img.onerror = () => {
        this._setFormat("png");
        resolve("png");
      };
      img.src = "data:image/webp;base64," + kTestImages.alpha;
    });
  }

  private static _setFormat(format: string): void {
    writeLocalStorage("midas.format", format);
    state.format = format;
  }

  private static _getSrcEquipement(contexte: MidasContexte, item: MidasItem, i = 0): string {
    let nom = item.nom;
    if (item.declinaison && Number(item.declinaison) > 0) nom += `_d${item.declinaison}`;
    if (item.dependCouleurPeau) nom += `_p${contexte.couleurPeau}`;
    if (item.dependPostureMainG) nom += `_m${contexte.postureMainG}`;
    if (item.dependPostureMainD) nom += `_n${contexte.postureMainD}`;
    nom += `_${i}`;

    let src = `${this._getRacineImages(contexte.sexe)}/vetements/${nom}${contexte.resolution}.${contexte.format}`;
    if (item.slot === "Fond") src = `${this._getRacineImages()}fonds/${nom}${contexte.resolution}.${contexte.format}`;
    else if (item.slot === "Cadre") src = `${this._getRacineImages()}cadres/${nom}${contexte.resolution}.${contexte.format}`;
    return src;
  }
}

// Restore cached webp-support detection (RK historical quirk, browser only).
state.format = readLocalStorage("midas.format") || null;

export { Midas };
