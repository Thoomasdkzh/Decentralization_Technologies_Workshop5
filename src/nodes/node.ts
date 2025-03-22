import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";

type NodeState = {
  killed: boolean; // Indique si le nœud a été arrêté
  x: 0 | 1 | "?" | null; // Valeur actuelle du consensus
  decided: boolean | null; // Indique si le nœud a atteint la finalité
  k: number | null; // Étape actuelle du nœud
};

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false, // Le nœud n'est pas arrêté au début
    x: isFaulty ? null : initialValue, // Si défectueux, x est null
    decided: isFaulty ? null : false, // Si défectueux, pas de décision prise
    k: isFaulty ? null : 0 // Si défectueux, l'étape est null
  };

  // Définir un type pour l'état attendu depuis l'API des autres nœuds
  interface NodeState {
    x: 0 | 1 | "?" | null;
    killed: boolean;
    decided: boolean | null;
    k: number | null;
  }

  let consensusInterval: NodeJS.Timeout | null = null;

  // TODO implement this
  // this route allows retrieving the current status of the node
  // node.get("/status", (req, res) => {});
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty"); // Statut défectueux
    } else {
      res.status(200).send("live"); // Nœud en vie
    }
  });
  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
  node.post("/message", (req, res) => {
    console.log(`Node ${nodeId} received message:`, req.body);
    res.sendStatus(200);
  });


  // TODO implement this
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});
  node.get("/start", async (req, res) => {
    if (isFaulty) {
      res.status(500).send("Cannot start consensus on a faulty node");
      return;
    }
    if (consensusInterval !== null || state.decided === true) {
      res.send("Consensus already started");
      return;
    }

    // Demander l'état des autres nœuds
    const fetchOtherStates = async (): Promise<(NodeState | null)[]> => {
      const promises = [];
      for (let i = 0; i < N; i++) {
        if (i !== nodeId) { // Ne pas interroger soi-même
          const url = `http://localhost:${BASE_NODE_PORT + i}/getState`;
          promises.push(
              fetch(url)
                  .then((res) => res.json() as Promise<NodeState>) // Casting vers le type NodeState
                  .catch((err) => null) // En cas d'erreur, retourner null
          );
        }
      }
      return Promise.all(promises);
    };


    const states = await fetchOtherStates();

    // Filtrer les réponses valides (celles qui ne sont pas null et correspondent à un nœud non défectueux)
    const healthyStates = states.filter(
        (state): state is NodeState => state !== null && state.x !== null && !state.killed
    );

    // Vérifier la majorité
    const ones = healthyStates.filter((state) => state.x === 1).length;
    const zeros = healthyStates.filter((state) => state.x === 0).length;


    if (F < N / 2) {
      // Prise de décision rapide selon la majorité
      const majority = ones >= zeros ? 1 : 0;
      state.x = majority;
      state.decided = true;
      state.k = 2; // Arrivé à la fin du processus
      console.log(`Node ${nodeId} decided: ${state.x}`);
    } else {
      // Cas où il y a beaucoup de nœuds défectueux, démarrer les étapes répétées
      if (state.k === 0) {
        state.k = 1;
      }
      consensusInterval = setInterval(() => {
        if (state.k !== null) {
          state.k++;
          console.log(`Node ${nodeId} round ${state.k}`);

          // Continuer sans prendre de décision lorsque k > 10
          if (state.k > 10) {
            console.log(`Node ${nodeId} continues without decision`);
          }

          if (state.k > 11) {
            clearInterval(consensusInterval as NodeJS.Timeout);
            consensusInterval = null;
          }
        }
      }, 200);

    }

    res.send("Consensus algorithm started");
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});
  node.get("/stop", async (req, res) => {
    if (consensusInterval) {
      clearInterval(consensusInterval);
      consensusInterval = null;
    }
    state.killed = true;
    res.send("Consensus algorithm stopped");
  });

  // TODO implement this
  // get the current state of a node
  // node.get("/getState", (req, res) => {});
  node.get("/getState", (req, res) => {
    res.status(200).json(state); // Retourner l'état actuel du nœud sous forme JSON
  });


  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
        `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}