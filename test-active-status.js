/**
 * Test script to verify the active status functionality
 */

// Simple test to verify the API endpoint works
async function testActiveStatusUpdate() {
  try {
    console.log('🧪 Testing active status update...')
    
    // Test data
    const testUserId = 1
    const testActive = false
    
    // Make API call
    const response = await fetch('http://localhost:3002/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: testUserId,
        active: testActive
      })
    })
    
    const data = await response.json()
    console.log('📡 API Response:', data)
    
    if (response.ok) {
      console.log('✅ Test passed: Active status updated successfully')
    } else {
      console.log('❌ Test failed:', data.error || data.msg)
    }
    
  } catch (error) {
    console.error('❌ Test error:', error)
  }
}

// Run the test
testActiveStatusUpdate()
