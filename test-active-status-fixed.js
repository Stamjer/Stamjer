/**
 * Test script to verify the active status update functionality
 */

// Simulate the API call
async function testActiveStatusUpdate() {
  const testData = {
    userId: "1", // String ID (which is what might come from localStorage)
    active: true
  }
  
  console.log('Testing active status update with:', testData)
  
  try {
    const response = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    })
    
    const result = await response.json()
    console.log('Response status:', response.status)
    console.log('Response data:', result)
    
    if (response.ok) {
      console.log('✅ Test passed - active status updated successfully')
    } else {
      console.log('❌ Test failed - got error:', result.error)
    }
  } catch (error) {
    console.error('❌ Test failed with exception:', error)
  }
}

// Test with number ID as well
async function testActiveStatusUpdateWithNumber() {
  const testData = {
    userId: 1, // Number ID
    active: false
  }
  
  console.log('Testing active status update with number ID:', testData)
  
  try {
    const response = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    })
    
    const result = await response.json()
    console.log('Response status:', response.status)
    console.log('Response data:', result)
    
    if (response.ok) {
      console.log('✅ Test passed - active status updated successfully')
    } else {
      console.log('❌ Test failed - got error:', result.error)
    }
  } catch (error) {
    console.error('❌ Test failed with exception:', error)
  }
}

// Run the tests
console.log('Starting active status update tests...')
testActiveStatusUpdate().then(() => {
  console.log('First test completed, running second test...')
  return testActiveStatusUpdateWithNumber()
}).then(() => {
  console.log('All tests completed!')
})
