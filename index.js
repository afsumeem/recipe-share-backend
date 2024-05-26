require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE);

const cors = require("cors");

app.use(cors());
app.use(express.json());
const router = express.Router();

// //
// const bodyParser = require("body-parser");
// app.use(bodyParser.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7s5ai.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// jwt token
const authenticateJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

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

    app.get("/users/:email", authenticateJWT, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    });
    app.get("/current-user", authenticateJWT, async (req, res) => {
      const email = req.user.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    });

    app.post("/users", async (req, res) => {
      const { email } = req.body;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res.status(409).json({ message: "User already exists" });
      }
      const result = await userCollection.insertOne(req.body);
      res.json(result);
    });
    // generate JWT token
    app.post("/generate-token", async (req, res) => {
      const { email } = req.body;
      const user = await userCollection.findOne({ email });
      if (user) {
        const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, {
          expiresIn: "1d",
        });
        res.json({ token });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    });

    //
    // get all recipes

    app.get("/recipes", async (req, res) => {
      const recipes = await recipeCollection
        .find(
          {},
          {
            projection: {
              name: 1,
              image: 1,
              country: 1,
              category: 1,
              creatorEmail: 1,
              purchased_by: 1,
            },
          }
        )
        .toArray();
      res.json(recipes);
    });

    // get single recipe by _id

    app.get("/recipes/:id", async (req, res) => {
      const id = req.params.id;
      const recipe = await recipeCollection.findOne({ _id: new ObjectId(id) });
      if (!recipe) {
        return res.status(404).json({ message: "Recipe not found" });
      }
      res.json(recipe);
    });

    //
    app.post("/unlock-recipe/:id", authenticateJWT, async (req, res) => {
      try {
        const recipeId = req.params.id;
        const userEmail = req.user.email;

        const recipe = await recipeCollection.findOne({
          _id: new ObjectId(recipeId),
        });

        if (!recipe) {
          return res
            .status(404)
            .json({ success: false, message: "Recipe not found" });
        }

        const user = await userCollection.findOne({ email: userEmail });

        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        // Check creator of the recipe
        if (user.email === recipe.creatorEmail) {
          return res
            .status(200)
            .json({ success: true, message: "No coin deduction needed" });
        }

        // Check enough coins
        if (user.coin < 10) {
          return res
            .status(403)
            .json({ success: false, message: "Insufficient coins" });
        }

        // Update coin
        await userCollection.updateOne(
          { email: userEmail },
          { $inc: { coin: -10 } }
        );

        await userCollection.updateOne(
          { email: recipe.creatorEmail },
          { $inc: { coin: 1 } }
        );

        // Add user's email to the purchased_by
        await recipeCollection.updateOne(
          { _id: new ObjectId(recipeId) },
          { $addToSet: { purchased_by: userEmail } }
        );

        // watch count
        await recipeCollection.updateOne(
          { _id: new ObjectId(recipeId) },
          { $inc: { watchCount: 1 } }
        );

        // Return success response
        return res
          .status(200)
          .json({ success: true, message: "Recipe unlocked successfully" });
      } catch (error) {
        console.error("Error unlocking recipe:", error);
        return res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    // post new recipe
    app.post("/recipes", authenticateJWT, async (req, res) => {
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
    app.post("/create-payment-intent", async (req, res) => {
      const { dollarAmount } = req.body;
      const amount = parseInt(dollarAmount * 100);
      // console.log(amount);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/update-coin-balance", authenticateJWT, async (req, res) => {
      const { email, coinAmount } = req.body;

      try {
        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const newCoinCount = user.coin + coinAmount;

        await userCollection.updateOne(
          { email },
          { $set: { coin: newCoinCount } }
        );

        res.json({ success: true, newCoinCount });
      } catch (error) {
        console.error("Error updating coin balance:", error);
        res.status(500).json({ message: "Internal server error" });
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
