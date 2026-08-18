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
    
    const email = 'jeanmyrvil1@gmail.com';
    const randomHex = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const licenseKey = `AUT-CLOUD-${randomHex()}-${randomHex()}-${randomHex()}`;
    const nowStr = new Date().toISOString();
    const docId = `cloud-jeanmyrvil1-gmail-com-${crypto.randomBytes(8).toString('hex')}`;
    
    // 1. Create main license document
    const licUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_licenses/${docId}`;
    
    const doc = {
      fields: {
        mode: { stringValue: 'hosted_credits' },
        tier: { stringValue: 'starter' },
        subscriptionStatus: { stringValue: 'active' },
        currency: { stringValue: 'USD' },
        subscriptionContractId: { nullValue: null },
        status: { stringValue: 'activated' },
        planName: { stringValue: 'Cloud Starter' },
        updatedAt: { stringValue: nowStr },
        shopifyVariantId: { stringValue: 'hosted_starter_variant' },
        licenseKey: { stringValue: licenseKey },
        billingInterval: { stringValue: 'monthly' },
        onboarding: { mapValue: { fields: { completed: { booleanValue: true } } } },
        orderName: { stringValue: `CLOUD-DIRECT-2026-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
        catalogSku: { stringValue: 'AUTO-SUB-STARTER-MONTHLY' },
        shopifyProductId: { stringValue: 'hosted_starter_prod' },
        source: { stringValue: 'gcloud_admin_test' },
        activatedAt: { stringValue: nowStr },
        orderId: { stringValue: docId },
        planPriceCents: { integerValue: '1999' },
        email: { stringValue: email },
        createdAt: { stringValue: nowStr },
        testEntitlement: { booleanValue: true },
        creditBalance: { integerValue: '500000' },
        customerId: { nullValue: null },
        lastShopifyOrderId: { nullValue: null }
      }
    };

    console.log(`Writing Hosted License document ${docId} to Firestore...`);
    const licResponse = await fetch(licUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(doc)
    });

    if (!licResponse.ok) {
      const errText = await licResponse.text();
      throw new Error(`HTTP error! status: ${licResponse.status}, body: ${errText}`);
    }

    console.log('✅ License document successfully written to automnia_licenses!');

    // 2. Create corresponding index document
    const indexId = licenseIndexId(email, licenseKey);
    const indexUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_license_indexes/${indexId}`;
    
    console.log(`Writing index document ${indexId} to Firestore...`);
    const indexDoc = {
      fields: {
        orderId: { stringValue: docId },
        createdAt: { stringValue: nowStr }
      }
    };

    const indexResponse = await fetch(indexUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(indexDoc)
    });

    if (!indexResponse.ok) {
      const errText = await indexResponse.text();
      throw new Error(`HTTP error! status: ${indexResponse.status}, body: ${errText}`);
    }

    console.log('✅ Index document successfully written to automnia_license_indexes!');
    console.log('\n=======================================');
    console.log('🎉 CLOUD LICENSE PROVISIONED SUCCESSFULLY!');
    console.log(`Email:          ${email}`);
    console.log(`New License Key: ${licenseKey}`);
    console.log(`Credit Balance: 500,000 credits`);
    console.log(`Mode:           hosted_credits`);
    console.log(`Document ID:    ${docId}`);
    console.log(`Index ID:       ${indexId}`);
    console.log('=======================================\n');
  } catch (error) {
    console.error('Error creating cloud license document:', error);
  }
}

run();
