// Point d'entrée générique : les plateformes qui ne reçoivent pas de
// start command explicite cherchent `index.js` par défaut (ex. Render,
// qui exécute "node index.js" et plantait avec
// "Cannot find module '/opt/render/project/src/index.js'").
// Le serveur réel est dans server.js ; ce fichier le démarre simplement.
import { startServer } from "./server.js";

startServer();
