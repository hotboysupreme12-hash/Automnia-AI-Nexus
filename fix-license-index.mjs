import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

function licenseIndexId(email, licenseKey) {
  const normEmail = String(email || '').trim().toLowerCase();
  const normKey = String(licenseKey || '').trim().toUpperCase();
  return crypto.createHash('sha256').update(`${normEmail}\u0000${normKey}`).digest('hex');
}

async function run() {
  try {
    const token = execSync('gcloud auth print-access-token').toString().trim();
    const projectId = 'project-7baf4a64-1c4f-4cff-94f';
    
    // List of licenses to index
    const licensesToIndex = [
      {
        email: 'hotboysupreme12@gmail.com',
        licenseKey: 'AUT-CLOUD-11AE-95B9-7834',
        orderId: '99887766',
        createdAt: '2026-06-09T01:20:15Z'
      },
      {
        email: 'jeanmyrvil1@gmail.com',
        licenseKey: 'AUT-BYOK-F11B-7FC9-630E',
        orderId: 'byok-jeanmyrvil1-gmail-com-e01a8ad3e6baa244',
        createdAt: new Date().toISOString()
      },
      {
        email: 'hotboysupreme3@gmail.com',
        licenseKey: 'AUT-CLOUD-4BC0-9AE6-2572',
        orderId: 'gcloud-test-starter-b7dfdab7f7d84602af1731d018925a3c',
        createdAt: new Date().toISOString()
      }
    ];

    for (const lic of licensesToIndex) {
      const indexId = licenseIndexId(lic.email, lic.licenseKey);
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_license_indexes/${indexId}`;
      
      console.log(`Writing index entry for ${lic.email} (${lic.licenseKey}) with ID ${indexId}...`);
      
      const doc = {
        fields: {
          orderId: { stringValue: lic.orderId },
          createdAt: { stringValue: lic.createdAt }
        }
      };

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(doc)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Failed for ${lic.email}: status ${response.status}, body: ${errText}`);
      } else {
        console.log(`Successfully indexed ${lic.email}!`);
      }
    }

    console.log('\nAll license index updates completed!');
  } catch (error) {
    console.error('Error running fix-license-index:', error);
  }
}

run();
