
import api from "@forge/api";
import fs from "fs";
import dotenv from "dotenv";
// API Credentials
dotenv.config();

const EMAIL = process.env.EMAIL;
const API_TOKEN = process.env.API_TOKEN;
const authHeader = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');

const WORKSPACE_ID = process.env.WORKSPACE_ID;
const BASE_URL = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1`;
const HEADERS = {
    "Authorization": `Basic ${authHeader}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
};

async function fetchAttributes(objectTypeId) {
    const url = `${BASE_URL}/objecttype/${objectTypeId}/attributes`;
    try {
        const response = await api.fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const attributes = await response.json();
        if (!Array.isArray(attributes)) {
            console.error("Attributes is not an array:", attributes);
            return [];
        }
        return attributes.map(attr => ({ id: attr.id, name: attr.name }));
    } catch (error) {
        console.error("Error fetching attributes:", error.message);
        return [];
    }
}

export async function fetchNetworkAssets(event, context) {
    const url = `${BASE_URL}/object/aql?startAt=0&maxResults=50&includeAttributes=true`;
    const payload = { qlQuery: "objectType = \"Network Assets\"" };
    
    try {
        const response = await api.fetch(url, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        const assets = data.values || [];

        if (assets.length === 0) {
            fs.writeFileSync("asset.json", JSON.stringify({ networkAssets: [] }, null, 2));
            return { networkAssets: [] };
        }

        const objectTypeId = assets[0]?.objectType?.id;
        console.log("Fetching attributes for objectTypeId:", objectTypeId);
        const attributes = await fetchAttributes(objectTypeId);
        const attributeMap = Object.fromEntries(attributes.map(attr => [attr.id, attr.name]));

        const formattedAssets = {
            networkAssets: assets.map(asset => ({
                id: asset.id,
                label: asset.label,
                objectKey: asset.objectKey,
                attributes: asset.attributes
                    .map(attr => ({
                        name: attributeMap[attr.objectTypeAttributeId],
                        value: attr.objectAttributeValues?.[0]?.value
                    }))
                    .filter(attr => attr.name && attr.value)
            }))
        };

        // Save response to asset.json
        fs.writeFileSync("./src/asset.json", JSON.stringify(formattedAssets, null, 2));
        console.log("Response saved to asset.json");

        return formattedAssets;
    } catch (error) {
        console.error("Error fetching network assets:", error.message);
        fs.writeFileSync("asset.json", JSON.stringify({ networkAssets: [] }, null, 2));
        return { networkAssets: [] };
    }
}



