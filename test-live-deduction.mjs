import { execSync } from 'node:child_process';

async function testDeduction() {
  try {
    const token = execSync('gcloud auth print-access-token').toString().trim();
    const projectId = 'groovy-iris-497718-f3';
    
    // First, fetch current credit balance
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_licenses/gcloud-test-starter-b7dfdab7f7d84602af1731d018925a3c`;
    
    console.log('1. Fetching initial balance from Firestore...');
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    let doc = await res.json();
    const initialBalance = Number(doc.fields?.creditBalance?.integerValue || doc.fields?.creditBalance?.doubleValue || 0);
    console.log(`Initial Credit Balance: ${initialBalance}`);

    // Perform a patch to simulate/test a credit deduction turn on Firestore for hotboysupreme3@gmail.com
    console.log('\n2. Testing credit deduction in Firestore...');
    const newBalance = Math.max(0, initialBalance - 100);
    
    const patchUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_licenses/gcloud-test-starter-b7dfdab7f7d84602af1731d018925a3c?updateMask.fieldPaths=creditBalance`;
    
    const updateRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          creditBalance: { integerValue: newBalance.toString() }
        }
      })
    });

    if (!updateRes.ok) {
      console.error('Update failed:', await updateRes.text());
      return;
    }

    console.log(`Updated Firestore document successfully to: ${newBalance}`);

    // Fetch again to verify updated balance
    console.log('\n3. Verifying updated balance...');
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    doc = await res.json();
    const finalBalance = Number(doc.fields?.creditBalance?.integerValue || doc.fields?.creditBalance?.doubleValue || 0);
    console.log(`Final Verified Credit Balance: ${finalBalance}`);
    console.log(`Deduction Difference: ${initialBalance - finalBalance} credits deducted.`);

  } catch (err) {
    console.error('Error during test:', err);
  }
}

testDeduction();
