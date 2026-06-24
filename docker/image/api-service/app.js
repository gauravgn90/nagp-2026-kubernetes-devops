const express = require("express");
const mysql = require("mysql2");
const app = express();
// const bodyParser = require("body-parser");
const PORT = 3000;
require("dotenv").config();
app.use(express.json());
app.use(express.urlencoded());
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
// Load environment variables from a .env file
const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "User API",
            version: "1.0.0",
            description: "API documentation for User CRUD operations",
            contact: {
                name: "Gaurav Kumar",
                email: "gaurav.kumar07@nagarro.com",
            },
            tags: [
                { name: "User", description: "Endpoints for managing users" }, // Change the operation tag here
                // Add more tags for different endpoints if needed
            ]
        },
        components: {
            schemas: {
                User: {
                    type: "object",
                    properties: {
                        phone: {
                            type: "string",
                            description: "The phone number of the user",
                        },
                        name: {
                            type: "string",
                            description: "The name of the user",
                        },
                        email: {
                            type: "string",
                            description: "The email of the user",
                        },
                    },
                },
            },
        },
    },
    apis: ["./app.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
// Create a MySQL connection pool
const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_DB_USERNAME,
    password: process.env.MYSQL_DB_PASSWORD,
    database: process.env.MYSQL_DB_NAME,
});

// log process env values
console.log("DB_HOST: ", process.env.MYSQL_HOST);
console.log("DB_USER: ", process.env.MYSQL_DB_USERNAME);
console.log("DB_PASSWORD: ", process.env.MYSQL_DB_PASSWORD);
console.log("DB_NAME: ", process.env.MYSQL_DB_NAME);
console.log("DB_PORT: ", process.env.MYSQL_PORT);


app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Define a route to fetch records from the users table
/**
 * @swagger
 * /users:
 *   get:
 *     summary: Retrieve all users
 *     description: Get a list of all users
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Success
 *       500:
 *         description: Error retrieving users
 */
app.get("/users", (req, res) => {
    pool.query("SELECT * FROM users", (error, results) => {
        if (error) {
            console.error("Error fetching users:", error);
            res.status(500).json({ message: "Error fetching users" });
        } else {
            console.log("Success fetching users:", results);
            res.json(results);
        }
    });
});

// apis to create users
/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     description: Create a new user with the provided data
 *     tags: [User]
 *     requestBody:
 *         description: Create a new user with the provided data in form of json object
 *         required: true
 *         content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: Success
 *       500:
 *         description: Error inserting user
 */
app.post("/users", (req, res) => {
    console.log("req.body: ", req.body);
    pool.query("INSERT INTO users SET ?", req.body, (error, results) => {
        if (error) {
            console.error("Error inserting users:", error);
            res.status(500).json({ message: "Error inserting users" });
        } else {
            console.log("Success inserting users:", results);
            res.json(results);
        }
    });
});

// APIs to update users
/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update a user
 *     description: Update an existing user with the provided data
 *     tags: [User]
 *     parameters:
 *       - name: id
 *         in: path
 *         description: User ID
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *         description: Update an existing user with the provided data in form of json object
 *         required: true
 *         content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: User not found
 *       500:
 *         description: Error updating user
 */
app.put("/users/:id", (req, res) => {
    const userId = req.params.id; // Get the user ID from the request parameters
    const updatedUserData = req.body; // Get the updated user data from the request body

    // Update the user in the database
    pool.query(
        "UPDATE users SET ? WHERE id = ?",
        [updatedUserData, userId],
        (error, results) => {
            if (error) {
                console.error("Error updating user:", error);
                res.status(500).send("Error updating user");
            } else if (results.affectedRows === 0) {
                res.status(404).json({ message: "User not found" });
            } else {
                console.log("Success updating user:", results);
                res.json({ message: "User updated successfully" });
            }
        }
    );
});

// APis to delete users
/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: Delete an existing user with the provided ID
 *     tags: [User]
 *     parameters:
 *       - name: id
 *         in: path
 *         description: User ID
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success
 *       404:
 *         description: User not found
 *       500:
 *         description: Error deleting user
 */
app.delete("/users/:id", (req, res) => {
    const userId = req.params.id; // Get the user ID from the request parameters

    // Delete the user with the specified ID from the database
    pool.query("DELETE FROM users WHERE id = ?", userId, (error, results) => {
        if (error) {
            console.error("Error deleting user:", error);
            res.status(500).send("Error deleting user");
        } else if (results.affectedRows === 0) {
            res.status(404).json({ message: "User not found" });
        } else {
            console.log("Success deleting user:", results);
            res.json({ message: "User deleted successfully" });
        }
    });
});

// Define a route to fetch a default message
/**
 * @swagger
 * /:
 *   get:
 *     summary: Get a default message
 *     description: Get a default message from the API service
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: The default message
 *     tags:
 *       - Default
 */
app.get("/", (req, res) => {
    res.json({
        message:
            "Hello from the API service! " +
            "Please visit /api-docs to view the API documentation",
    });
});

// Start the server
app.listen(PORT, () => {
    console.log("Server listening on port 3000");
});