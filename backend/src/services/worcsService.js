// src/services/worcsService.js - Wisconsin DOJ WORCS SOAP Integration
const axios = require('axios');

const WORCS_WSDL = 'https://worcs-services.doj.wi.gov/Worcs.svc?singleWsdl';
const WORCS_ENDPOINT = 'https://worcs-services.doj.wi.gov/Worcs.svc';

// Build SOAP envelope for name-based background check (Caregiver-General)
const buildSOAPRequest = (credentials, applicantData) => {
  const { username, password, accountNumber } = credentials;
  const { firstName, lastName, dateOfBirth, ssn, requestPurpose = 'Caregiver-General' } = applicantData;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wor="http://worcs.doj.wi.gov/">
  <soap:Header>
    <wor:AuthHeader>
      <wor:Username>${escapeXml(username)}</wor:Username>
      <wor:Password>${escapeXml(password)}</wor:Password>
      <wor:AccountNumber>${escapeXml(accountNumber)}</wor:AccountNumber>
    </wor:AuthHeader>
  </soap:Header>
  <soap:Body>
    <wor:SubmitNameBasedRequest>
      <wor:request>
        <wor:FirstName>${escapeXml(firstName)}</wor:FirstName>
        <wor:LastName>${escapeXml(lastName)}</wor:LastName>
        <wor:DateOfBirth>${dateOfBirth}</wor:DateOfBirth>
        <wor:SSN>${ssn}</wor:SSN>
        <wor:RequestPurpose>${requestPurpose}</wor:RequestPurpose>
        <wor:RequesterReference>${Date.now()}</wor:RequesterReference>
      </wor:request>
    </wor:SubmitNameBasedRequest>
  </soap:Body>
</soap:Envelope>`;
};

const buildResultsSOAP = (credentials, referenceNumber) => {
  const { username, password, accountNumber } = credentials;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wor="http://worcs.doj.wi.gov/">
  <soap:Header>
    <wor:AuthHeader>
      <wor:Username>${escapeXml(username)}</wor:Username>
      <wor:Password>${escapeXml(password)}</wor:Password>
      <wor:AccountNumber>${escapeXml(accountNumber)}</wor:AccountNumber>
    </wor:AuthHeader>
  </soap:Header>
  <soap:Body>
    <wor:GetRequestResults>
      <wor:referenceNumber>${escapeXml(referenceNumber)}</wor:referenceNumber>
    </wor:GetRequestResults>
  </soap:Body>
</soap:Envelope>`;
};

const escapeXml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

// Parse SOAP XML response to extract reference number and status
const parseSOAPResponse = (xml) => {
  const refMatch = xml.match(/<ReferenceNumber[^>]*>([^<]+)<\/ReferenceNumber>/i);
  const statusMatch = xml.match(/<Status[^>]*>([^<]+)<\/Status>/i);
  const errorMatch = xml.match(/<ErrorMessage[^>]*>([^<]+)<\/ErrorMessage>/i);
  const resultMatch = xml.match(/<Result[^>]*>([^<]+)<\/Result>/i);
  const recordMatch = xml.match(/<HasRecord[^>]*>([^<]+)<\/HasRecord>/i);

  return {
    referenceNumber: refMatch ? refMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
    result: resultMatch ? resultMatch[1].trim() : null,
    hasRecord: recordMatch ? recordMatch[1].trim().toLowerCase() === 'true' : null,
    error: errorMatch ? errorMatch[1].trim() : null,
    rawXml: xml,
  };
};

/**
 * Submit a name-based background check to Wisconsin DOJ WORCS
 * Returns a reference number for polling results
 */
const submitBackgroundCheck = async (applicantData) => {
  const credentials = {
    username: process.env.WORCS_USERNAME,
    password: process.env.WORCS_PASSWORD,
    accountNumber: process.env.WORCS_ACCOUNT_NUMBER,
  };

  // In development/staging without credentials, return mock response
  if (!credentials.username || !credentials.password) {
    console.warn('[WORCS] No credentials configured — returning mock pending response');
    return {
      success: true,
      referenceNumber: `MOCK-${Date.now()}`,
      status: 'pending',
      mock: true,
    };
  }

  try {
    const soapBody = buildSOAPRequest(credentials, applicantData);

    const response = await axios.post(WORCS_ENDPOINT, soapBody, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://worcs.doj.wi.gov/IWorcs/SubmitNameBasedRequest',
      },
      timeout: 30000,
    });

    const parsed = parseSOAPResponse(response.data);

    if (parsed.error) {
      throw new Error(`WORCS Error: ${parsed.error}`);
    }

    return {
      success: true,
      referenceNumber: parsed.referenceNumber,
      status: 'pending',
    };
  } catch (error) {
    console.error('[WORCS] Submit error:', error.message);
    throw new Error(`Background check submission failed: ${error.message}`);
  }
};

/**
 * Poll WORCS for results of a previously submitted check
 */
const getCheckResults = async (referenceNumber) => {
  // Mock response for development
  if (referenceNumber.startsWith('MOCK-')) {
    return {
      referenceNumber,
      status: 'completed',
      result: 'cleared',
      hasRecord: false,
      completedAt: new Date().toISOString(),
      mock: true,
    };
  }

  const credentials = {
    username: process.env.WORCS_USERNAME,
    password: process.env.WORCS_PASSWORD,
    accountNumber: process.env.WORCS_ACCOUNT_NUMBER,
  };

  if (!credentials.username) {
    throw new Error('WORCS credentials not configured');
  }

  try {
    const soapBody = buildResultsSOAP(credentials, referenceNumber);

    const response = await axios.post(WORCS_ENDPOINT, soapBody, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://worcs.doj.wi.gov/IWorcs/GetRequestResults',
      },
      timeout: 30000,
    });

    const parsed = parseSOAPResponse(response.data);

    let result = 'pending';
    if (parsed.status === 'Completed' || parsed.status === 'Complete') {
      result = parsed.hasRecord ? 'record_found' : 'cleared';
    } else if (parsed.status === 'Error' || parsed.status === 'Failed') {
      result = 'error';
    }

    return {
      referenceNumber,
      status: parsed.status === 'Completed' ? 'completed' : 'pending',
      result,
      hasRecord: parsed.hasRecord,
      rawResult: parsed.result,
      completedAt: result !== 'pending' ? new Date().toISOString() : null,
    };
  } catch (error) {
    console.error('[WORCS] Results error:', error.message);
    throw new Error(`Failed to retrieve results: ${error.message}`);
  }
};

module.exports = { submitBackgroundCheck, getCheckResults };
