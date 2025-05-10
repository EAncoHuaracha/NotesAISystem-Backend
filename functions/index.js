const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const cors = require("cors");
require("dotenv").config();
const Replicate = require("replicate");

admin.initializeApp();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware de autenticación
const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "No autorizado" });
    }

    try {
        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        req.user = decodedToken;
        next();
    } catch (err) {
        res.status(401).json({ message: "Invalid token" });
    }
};

// MongoDB
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
let mongoReady = client.connect();
const getDb = async () => (await mongoReady).db("NotesAI");

// === PROJECTS API ===
app.get("/projects", authenticate, async (req, res) => {
    try {
        const db = await getDb();
        const data = await db.collection("Projects")
            .find({ ownerEmail: req.user.email })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json(data);
    } catch {
        res.status(500).send("Error getting projects");
    }
});


app.get("/projects/:id", authenticate, async (req, res) => {
    try {
        const db = await getDb();
        const project = await db.collection("Projects").findOne({ _id: new ObjectId(req.params.id) });
        if (!project) return res.status(404).json({ message: "Project not found" });
        res.status(200).json(project);
    } catch {
        res.status(400).send("Error getting project");
    }
});

app.post("/projects", authenticate, async (req, res) => {
    try {
        const db = await getDb();

        const project = {
            name: req.body.name,
            createdAt: new Date(),
            ownerEmail: req.user.email
        };

        const result = await db.collection("Projects").insertOne(project);

        res.status(201).json({ id: result.insertedId });
    } catch {
        res.status(400).send("Error creating project");
    }
});

app.put("/projects/:id", authenticate, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection("Projects").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: req.body }
        );
        res.status(200).json({ message: "Project updated" });
    } catch {
        res.status(400).send("Error updating project");
    }
});

app.delete("/projects/:id", authenticate, async (req, res) => {
    try {
        const db = await getDb();
        await db.collection("Projects").deleteOne({ _id: new ObjectId(req.params.id) });
        res.status(200).json({ message: "Project deleted" });
    } catch {
        res.status(400).send("Error deleting project");
    }
});

// === IA API ===
const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN
});

app.post("/projects/ai/process", authenticate, async (req, res) => {
    const { imageBase64, prompt } = req.body;

    if (!imageBase64 || !prompt) {
        return res.status(400).json({ message: "Image and prompt are required" });
    }

    try {
        const input = {
            image: imageBase64,
            prompt: prompt,
            lora_weights: "https://pbxt.replicate.delivery/mwN3AFyYZyouOB03Uhw8ubKW9rpqMgdtL9zYV9GF2WGDiwbE/trained_model.tar",
            refine_steps: 20,
            condition_scale: 0.5,
            num_inference_steps: 40
        };

        const output = await replicate.run("fermatresearch/sdxl-controlnet-lora:3bb13fe1c33c35987b33792b01b71ed6529d03f165d1c2416375859f09ca9fef", { input });
        res.status(200).json({ result: output[0].url() });

    } catch (err) {
        console.error("Error using Replicate:", err);
        res.status(500).json({ message: "Error processing image" });
    }
});

// Export Firebase Function
exports.api = functions.https.onRequest(app);
