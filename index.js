require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

const cors = require("cors");

app.use(cors());
app.use(express.json());

// //
// const bodyParser = require("body-parser");
// app.use(bodyParser.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7s5ai.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const run = async () => {
  try {
    const db = client.db("recipeShare");
    const userCollection = db.collection("users");
    const recipeCollection = db.collection("recipes");

    //users
    app.get("/users", async (req, res) => {
      const user = await userCollection.find({}).toArray();
      // console.log(user);
      res.json(user);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    });

    //
    app.post("/users", async (req, res) => {
      const { email } = req.body;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res.status(409).json({ message: "User already exists" });
      }
      const result = await userCollection.insertOne(req.body);
      res.json(result);
    });

    //update user
    app.put("/users/:id", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      const options = { upsert: true };
      const updateUser = { $set: user };
      const result = await userCollection.updateOne(
        filter,
        updateUser,
        options
      );
      res.json(result);
    });

    //
    // get all recipes

    app.get("/recipes", async (req, res) => {
      const recipes = await recipeCollection.find({}).toArray();
      // console.log(recipes);
      res.json(recipes);
    });

    // post new recipe
    app.post("/recipes", async (req, res) => {
      const { creatorEmail } = req.body;
      const result = await recipeCollection.insertOne(req.body);
      if (result.insertedId) {
        const user = await userCollection.findOne({ email: creatorEmail });
        const newCoinCount = user.coin + 1;
        await userCollection.updateOne(
          { email: creatorEmail },
          { $set: { coin: newCoinCount } }
        );
        res.json(result);
      } else {
        res.status(500).json({ message: "Failed to add recipe" });
      }
    });

    //
  } finally {
  }
};

run().catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  // console.log(`Example app listening on port ${port}`);
});
