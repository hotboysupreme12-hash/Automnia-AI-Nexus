import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

async function run() {
  try {
    const token = execSync('gcloud auth print-access-token').toString().trim();
    const projectId = 'groovy-iris-497718-f3';
    
    const email = 'jeanmyrvil1@gmail.com';
    const randomHex = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const licenseKey = `AUT-BYOK-${randomHex()}-${randomHex()}-${randomHex()}`;
    const nowStr = new Date().toISOString();
    const docId = `byok-jeanmyrvil1-gmail-com-${crypto.randomBytes(8).toString('hex')}`;
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/automnia_licenses/${docId}`;
    
    const doc = {
      fields: {
        mode: { stringValue: 'byok' },
        tier: { stringValue: 'founding_beta_byok' },
        subscriptionStatus: { stringValue: 'active' },
        currency: { stringValue: 'USD' },
        subscriptionContractId: { nullValue: null },
        status: { stringValue: 'activated' },
        planName: { stringValue: 'BYOK Founding Beta' },
        updatedAt: { stringValue: nowStr },
        shopifyVariantId: { stringValue: 'byok_direct' },
        licenseKey: { stringValue: licenseKey },
        billingInterval: { stringValue: 'lifetime' },
        onboarding: { mapValue: { fields: { completed: { booleanValue: true } } } },
        orderName: { stringValue: `BYOK-DIRECT-2026-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
        catalogSku: { stringValue: 'AUTO-SUB-BYOK-LIFETIME' },
        shopifyProductId: { stringValue: 'byok_direct_prod' },
        source: { stringValue: 'gcloud_admin_test' },
        activatedAt: { stringValue: nowStr },
        orderId: { stringValue: docId },
        planPriceCents: { integerValue: '0' },
        email: { stringValue: email },
        createdAt: { stringValue: nowStr },
        testEntitlement: { booleanValue: true },
        creditBalance: { integerValue: '0' },
        customerId: { nullValue: null },
        lastShopifyOrderId: { nullValue: null }
      }
    };

    console.log(`Writing BYOK license document ${docId} to Firestore...`);
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
      throw new Error(`HTTP error! status: ${response.status}, body: ${errText}`);
    }

    const result = await response.json();
    console.log('\n=======================================');
    console.log('✅ BYOK License Created Successfully!');
    console.log(`Email:       ${email}`);
    console.log(`License Key: ${licenseKey}`);
    console.log(`Document ID: ${docId}`);
    console.log('=======================================\n');
  } catch (error) {
    console.error('Error creating license document:', error);
  }
}

run();
