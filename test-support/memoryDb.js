// Minimal MongoDB substitute for isolation/migration tests. No network or files.
function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((part) => matches(document, part))
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === '$exists') return Object.hasOwn(document, key) === expected
        if (operator === '$gt') return document[key] > expected
        if (operator === '$lt') return document[key] < expected
        if (operator === '$lte') return document[key] <= expected
        if (operator === '$ne') return document[key] !== expected
        if (operator === '$in') return expected.includes(document[key])
        throw new Error(`Unsupported test operator: ${operator}`)
      })
    }
    return document[key] === value || (value === null && document[key] === undefined)
  })
}

export function createMemoryDb(initial = {}) {
  const data = structuredClone(initial)
  const writes = []
  const indexes = new Map()
  function collection(name) {
    const documents = () => data[name] || []
    return {
      collectionName: name,
      find(filter = {}) {
        let projection = null
        let sorting = null
        let offset = 0
        let limit = Infinity
        return {
          project(value) { projection = value; return this },
          sort(value) { sorting = value; return this },
          skip(value) { offset = value; return this },
          limit(value) { limit = value; return this },
          async toArray() {
            const selected = documents().filter((doc) => matches(doc, filter))
            if (sorting) selected.sort((a, b) => {
              for (const [key, direction] of Object.entries(sorting)) {
                if (a[key] < b[key]) return -direction
                if (a[key] > b[key]) return direction
              }
              return 0
            })
            return selected.slice(offset, offset + limit).map((doc) => {
              const copy = structuredClone(doc)
              if (projection?._id === 0) delete copy._id
              return copy
            })
          }
        }
      },
      async findOne(filter) { return structuredClone(documents().find((doc) => matches(doc, filter)) || null) },
      async countDocuments(filter) { return documents().filter((doc) => matches(doc, filter)).length },
      async indexes() { return indexes.get(name) || [] },
      async createIndex(key, options) {
        writes.push({ name, action: 'createIndex', key })
        indexes.set(name, [...(indexes.get(name) || []), { key, ...options }])
        return options.name
      },
      async updateOne(filter, update, options = {}) {
        writes.push({ name, action: 'updateOne', filter, update })
        let doc = documents().find((candidate) => matches(candidate, filter))
        if (!doc && options.upsert) {
          doc = { ...filter, ...structuredClone(update.$setOnInsert || {}) }
          data[name] ||= []
          data[name].push(doc)
        }
        if (doc) for (const [path, value] of Object.entries(update.$set || {})) {
          const parts = path.split('.')
          let target = doc
          for (const part of parts.slice(0, -1)) target = target[part] ||= {}
          target[parts.at(-1)] = structuredClone(value)
        }
        if (doc) for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value
        return { matchedCount: doc ? 1 : 0 }
      },
      async updateMany(filter, update) {
        for (const doc of documents().filter((candidate) => matches(candidate, filter))) {
          await this.updateOne({ ...doc }, update)
        }
      },
      async insertOne(doc) {
        writes.push({ name, action: 'insertOne' })
        data[name] ||= []
        data[name].push(structuredClone(doc))
        return { insertedId: doc.id }
      },
      async bulkWrite(operations) {
        for (const { updateOne } of operations) await this.updateOne(updateOne.filter, updateOne.update)
      },
      async deleteMany(filter) {
        const before = documents().length
        data[name] = documents().filter((doc) => !matches(doc, filter))
        writes.push({ name, action: 'deleteMany' })
        return { deletedCount: before - data[name].length }
      },
      async deleteOne(filter) { return this.deleteMany(filter) }
    }
  }
  return {
    data, writes, collection,
    listCollections() { return { async toArray() { return Object.keys(data).map((name) => ({ name })) } } }
  }
}

// Serialized transaction substitute with rollback/failure injection support.
// It verifies application atomicity, not MongoDB snapshot/locking semantics.
export function createMemoryClient(db) {
  let queue = Promise.resolve()
  return {
    db: () => db,
    startSession() {
      return {
        async withTransaction(work) {
          const previous = queue
          let release
          queue = new Promise(resolve => { release = resolve })
          await previous
          const snapshot = structuredClone(db.data)
          const writeCount = db.writes.length
          try { return await work() } catch (error) {
            for (const key of Object.keys(db.data)) delete db.data[key]
            Object.assign(db.data, snapshot)
            db.writes.splice(writeCount)
            throw error
          } finally { release() }
        },
        async endSession() {}
      }
    }
  }
}
