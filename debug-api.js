// Simple test to debug the API call
console.log('🔍 Starting API debug test...')

const testData = {
  userId: 1,
  active: false
}

console.log('📤 Sending request with data:', testData)

fetch('http://localhost:3002/api/user/profile', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testData)
})
.then(response => {
  console.log('📡 Response status:', response.status)
  console.log('📡 Response headers:', response.headers)
  return response.json()
})
.then(data => {
  console.log('📥 Response data:', data)
})
.catch(error => {
  console.error('❌ Error:', error)
})
