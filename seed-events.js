/**
 * seed-users.js
 * Read data/users.json and insert all users into MongoDB Atlas.
 */

import 'dotenv/config'
import fs from 'fs/promises'
import { MongoClient } from 'mongodb'

async function seedUsers() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI not set')

  // Load the JSON file
  const raw = await fs.readFile(new URL('./data/users.json', import.meta.url), 'utf-8')
  const { users } = JSON.parse(raw)
  if (!Array.isArray(users)) throw new Error('Invalid data format in users.json')

  // Connect to MongoDB
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  await client.connect()
  const db = client.db('Stamjer')

  // Replace entire collection
  await db.collection('users').deleteMany({})
  const result = await db.collection('users').insertMany(users)
  console.log(`✅ Inserted ${result.insertedCount} users into MongoDB`)

  await client.close()
}

seedUsers()
  .catch(err => {
    console.error('❌ Seeding failed:', err)
    process.exit(1)
  })
