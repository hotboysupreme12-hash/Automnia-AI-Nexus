import { execSync } from 'node:child_process';

async function run() {
  try {
    const token = execSync('gcloud auth print-access-token').toString().trim();
    const projectId = 'project-7baf4a64-1c4f-4cff-94f';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_licenses?pageSize=1000`;
    
    console.log('Fetching licenses from Firestore...');
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const docs = data.documents || [];
    
    console.log(`Found ${docs.length} documents.`);
    
    // Search for hotboysupreme3@gmail.com or other records
    for (const doc of docs) {
      const email = doc.fields?.email?.stringValue;
      const licenseKey = doc.fields?.licenseKey?.stringValue;
      const creditBalance = doc.fields?.creditBalance?.integerValue || doc.fields?.creditBalance?.doubleValue;
      const tier = doc.fields?.tier?.stringValue;
      
      if (email) {
        console.log('\n=== MATCH FOUND ===');
        console.log(`Document Name: ${doc.name}`);
        console.log(`Email: ${email}`);
        console.log(`License Key: ${licenseKey}`);
        console.log(`Credit Balance: ${creditBalance}`);
        console.log(`Tier: ${tier}`);
        console.log('===================\n');
      }
    }
  } catch (error) {
    console.error('Error querying Firestore:', error);
  }
}

run();
