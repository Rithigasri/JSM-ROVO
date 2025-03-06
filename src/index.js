import api, { route,requestConfluence } from "@forge/api";
import fs from "fs";
import dotenv from "dotenv";
// API Credentials
dotenv.config();

const EMAIL = "rithigasri.b@cprime.com";
const API_TOKEN = "******";
const WORKSPACE_ID = "9639f74b-a7d7-4189-9acb-9a493cbfe46f";
const authHeader = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');


const BASE_URL = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1`;
const HEADERS = {
    "Authorization": `Basic ${authHeader}`,
    "Accept": "application/json",
    "Content-Type": "application/json"
};


async function fetchObjectTypes() {
    const url = `${BASE_URL}/objectschema/11/objecttypes`;
    try {
        const response = await api.fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const objectTypes = await response.json();
        return objectTypes.map(type => type.name);
    } catch (error) {
        console.error("Error fetching object types:", error.message);
        return [];
    }
}

async function saveObjectTypesToFile(objectTypes) {
    try {
        fs.writeFileSync("classified.txt", objectTypes.join("\n"));
        console.log("Object types saved to classified.txt");
    } catch (error) {
        console.error("Error saving object types to file:", error.message);
    }
}

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
async function createConfluencePage(spaceKey, title, content) {
    const CONFLUENCE_BASE_URL = `https://one-atlas-onki.atlassian.net/wiki/rest/api/content`;

    // Ensure JSON content is properly formatted
    const formattedContent = `<![CDATA[${content}]]>`;

    const payload = {
        type: "page",
        title: title,
        space: { key: spaceKey },
        body: {
            storage: {
                value: `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">json</ac:parameter><ac:plain-text-body>${formattedContent}</ac:plain-text-body></ac:structured-macro>`,
                representation: "storage"
            }
        }
    };

    try {
        const response = await api.fetch(CONFLUENCE_BASE_URL, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const responseData = await response.json();
        console.log(`Page created successfully: ${responseData._links.base}${responseData._links.webui}`);
    } catch (error) {
        console.error("Error creating Confluence page:", error.message);
    }
}


export async function fetchAndClassify(event, context) {
    const objectTypes = await fetchObjectTypes();
    await saveObjectTypesToFile(objectTypes);

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
            await createConfluencePage("JSMROVO", "Network Assets Report", "No network assets found.");
            return { networkAssets: [] };
        }

        const objectTypeId = assets[0]?.objectType?.id;
        console.log("Fetching attributes for objectTypeId:", objectTypeId);
        const attributes = await fetchAttributes(objectTypeId);
        const attributeMap = Object.fromEntries(attributes.map(attr => [attr.id, attr.name]));

        const formattedAssets = {
            networkAssets: assets.map(asset => {
                let attributeData = {};
                asset.attributes.forEach(attr => {
                    const name = attributeMap[attr.objectTypeAttributeId];
                    if (name && attr.objectAttributeValues?.[0]?.value) {
                        attributeData[name] = attr.objectAttributeValues[0].value;
                    }
                });

                return {
                    id: asset.id,
                    label: asset.label,
                    objectKey: asset.objectKey,
                    ...attributeData
                };
            })
        };

        // Convert the formatted assets to a JSON string for Confluence
        const confluenceContent = JSON.stringify(formattedAssets, null, 2);
        await createConfluencePage("JSMROVO", "Network Assets Report", confluenceContent);

        return formattedAssets;
    } catch (error) {
        console.error("Error fetching network assets:", error.message);
        await createConfluencePage("JSMROVO", "Network Assets Report", "Error fetching network assets.");
        return { networkAssets: [] };
    }
}



export async function createObjectTypes(event) {
    console.log("Fetching Confluence page content...");
    const pageId = "10420225";
    const confluenceUrl = route`/wiki/rest/api/content/${pageId}?expand=body.storage`;

    try {
        // Fetch Confluence page content
        const confluenceResponse = await api.asApp().requestConfluence(confluenceUrl, {
            method: "GET",
            headers: { "Accept": "application/json" }
        });

        if (!confluenceResponse.ok) {
            console.error("Failed to fetch Confluence page:", confluenceResponse.status);
            return;
        }

        const confluenceData = await confluenceResponse.json();
        const pageContent = confluenceData.body.storage.value;

        console.log("Confluence Page Content:", pageContent);

        // Extract and format unique object types
        const newObjectTypes = [...new Set(
            pageContent.split(',')
                .map(type => type.trim())
                .filter(Boolean)
        )];

        console.log("Unique Parsed Object Types:", newObjectTypes);

        // Fetch existing object types
        const workspaceId = "9639f74b-a7d7-4189-9acb-9a493cbfe46f"; // Replace with actual workspace ID
        const schemaId = 11;
        const fetchUrl = `https://api.atlassian.com/jsm/assets/workspace/${workspaceId}/v1/objectschema/${schemaId}/objecttypes`;

        const fetchResponse = await api.fetch(fetchUrl, {
            method: "GET",
            headers: HEADERS
        });

        if (!fetchResponse.ok) {
            console.error("Failed to fetch object types:", fetchResponse.status);
            return;
        }

        const responseData = await fetchResponse.json();

        if (!Array.isArray(responseData)) {
            console.error("Unexpected API response format. Expected an array.");
            return;
        }

        const existingObjectTypes = new Set(responseData.map(obj => obj.name));
        console.log("Existing Object Types:", existingObjectTypes);

        // Identify missing object types
        const missingObjectTypes = newObjectTypes.filter(type => !existingObjectTypes.has(type));
        console.log("Missing Object Types:", missingObjectTypes);

        // Create only missing object types
        for (const objectType of missingObjectTypes) {
            console.log(`Creating object type: ${objectType}`);

            const createUrl = `https://api.atlassian.com/jsm/assets/workspace/${workspaceId}/v1/objecttype/create`;
            const payload = {
                inherited: false,
                abstractObjectType: false,
                objectSchemaId: schemaId,
                iconId: "13", // Default icon ID, modify as needed
                name: objectType,
                description: `Auto-created object type: ${objectType}`
            };

            const createResponse = await api.fetch(createUrl, {
                method: "POST",
                headers: {
                    ...HEADERS,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!createResponse.ok) {
                console.error(`Failed to create object type ${objectType}:`, createResponse.status);
            } else {
                console.log(`Successfully created object type: ${objectType}`);
            }
        }
    } catch (error) {
        console.error("Error in createObjectTypes:", error);
    }
}

// ...existing code...

// Fetch Network Assets JSON from Confluence
async function getConfluenceAssets() {
    const pageId = "10944513";
    const confluenceUrl = route`/wiki/rest/api/content/${pageId}?expand=body.storage`;

    try {
        const response = await api.asApp().requestConfluence(confluenceUrl, {
            method: "GET",
            headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
            console.error("Failed to fetch Confluence page:", response.status);
            return [];
        }

        const confluenceData = await response.json();
        const pageContent = confluenceData.body.storage.value;

        // Extract and parse JSON content
        return parseConfluenceJSON(pageContent);
    } catch (error) {
        console.error("Error fetching Confluence assets:", error.message);
        return [];
    }
}

// Parse JSON Content from Confluence
function parseConfluenceJSON(content) {
    try {
        // Ensure the content is properly wrapped in CDATA
        const cdataStart = content.indexOf("<![CDATA[");
        const cdataEnd = content.indexOf("]]>");
        if (cdataStart === -1 || cdataEnd === -1) {
            console.error("CDATA section not found in Confluence content.");
            return [];
        }

        const jsonString = content.substring(cdataStart + 9, cdataEnd);
        const parsedData = JSON.parse(jsonString);
        return parsedData.networkAssets || [];
    } catch (error) {
        console.error("Error parsing Confluence JSON:", error.message);
        return [];
    }
}

// Fetch Object Type Mapping from JSM
async function getObjectTypeMapping() {
    const url = `${BASE_URL}/objectschema/11/objecttypes`;

    try {
        const response = await api.fetch(url, { headers: HEADERS });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const objectTypes = await response.json();
        if (!Array.isArray(objectTypes)) {
            console.error("Unexpected response format for object types:", objectTypes);
            return {};
        }

        // Store object types in a map { "Monitor": id, "Software": id, ... }
        return Object.fromEntries(objectTypes.map(type => [type.name, type.id]));
    } catch (error) {
        console.error("Error fetching object types:", error.message);
        return {};
    }
}

// Read Object Type Names from Confluence
async function getConfluenceObjectTypes() {
    const pageId = "10420225";
    const confluenceUrl = route`/wiki/rest/api/content/${pageId}?expand=body.storage`;

    try {
        const response = await api.asApp().requestConfluence(confluenceUrl, {
            method: "GET",
            headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
            console.error("Failed to fetch Confluence page:", response.status);
            return [];
        }

        const confluenceData = await response.json();
        const pageContent = confluenceData.body.storage.value;

        // Split content by commas and return as a list
        const objectTypeNames = pageContent.split(",").map(item => item.trim());
        console.log("Object Type Names from Confluence:", objectTypeNames);
        return objectTypeNames;
    } catch (error) {
        console.error("Error fetching object types from Confluence:", error.message);
        return [];
    }
}



// async function createObjectTypeAttribute(objectTypeId, attributeName, attributeType = "0", defaultTypeId = "0") {
//     const createAttributeUrl = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1/objecttypeattribute/${objectTypeId}`;
//     const payload = {
//         name: attributeName,
//         type: attributeType,
//         defaultTypeId: defaultTypeId
//     };

//     try {
//         const response = await api.fetch(createAttributeUrl, {
//             method: "POST",
//             headers: {
//                 ...HEADERS,
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify(payload)
//         });

//         if (!response.ok) {
//             const errorResponse = await response.json();
//             console.error(`Failed to create attribute ${attributeName} for object type ${objectTypeId}:`, response.status, errorResponse);
//             return null;
//         } else {
//             const responseData = await response.json();
//             console.log(`Successfully created attribute ${attributeName} for object type ${objectTypeId}`);
//             return responseData.id;
//         }
//     } catch (error) {
//         console.error(`Error creating attribute ${attributeName} for object type ${objectTypeId}:`, error.message);
//         return null;
//     }
// }

// // Main function to map and print object types and assets
// export async function postObjects(event, context) {
//     // Step 1: Fetch object types from JSM
//     const objectTypeMap = await getObjectTypeMapping();
//     if (!objectTypeMap || Object.keys(objectTypeMap).length === 0) {
//         console.error("Failed to fetch object types.");
//         return;
//     }

//     // Print object types and their IDs
//     console.log("Object Types and their IDs:");
//     for (const [name, id] of Object.entries(objectTypeMap)) {
//         console.log(`${name}: ${id}`);
//     }

//     // Step 2: Read object type names from Confluence (Page ID: 10420225)
//     const objectTypeNames = await getConfluenceObjectTypes();
//     if (!objectTypeNames || objectTypeNames.length === 0) {
//         console.error("No object type names found in Confluence.");
//         return;
//     }

//     // Step 3: Fetch JSON objects from Confluence (Page ID: 10584117)
//     const confluenceAssets = await getConfluenceAssets();
//     if (!confluenceAssets || confluenceAssets.length === 0) {
//         console.error("No assets found in Confluence.");
//         return;
//     }

//     // Step 4: Map and print in required format
//     console.log("Mapped list is:");
//     for (const asset of confluenceAssets) {
//         const objectTypeName = objectTypeNames[0]; // Assume first word in the list defines object type

//         if (!objectTypeName || !objectTypeMap[objectTypeName]) {
//             console.warn(`No matching object type found for '${objectTypeName}'. Skipping asset:`, asset);
//             continue;
//         }

//         const objectTypeId = objectTypeMap[objectTypeName];

//         // Required output format: "{some content} software 130"
//         console.log(`${asset.Name} ${objectTypeName} ${objectTypeId}`);

//         // Create required attributes for the object type
//         const attributeIds = {};
//         const attributeNames = ["Name", "Status", "RenewalDate", "SaasProvider", "Category", "Key", "Created", "Updated"];
//         for (const attributeName of attributeNames) {
//             const attributeId = await createObjectTypeAttribute(objectTypeId, attributeName);
//             if (attributeId) {
//                 attributeIds[attributeName] = attributeId;
//             } else {
//                 console.error(`Failed to create attribute ${attributeName} for object type ${objectTypeId}. Skipping asset:`, asset);
//                 continue;
//             }
//         }

//         // Prepare attributes for the POST request
//         const attributes = [
//             {
//                 objectTypeAttributeId: attributeIds["Name"],
//                 objectAttributeValues: [{ value: asset.Name }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["Status"],
//                 objectAttributeValues: [{ value: asset.Status }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["RenewalDate"],
//                 objectAttributeValues: [{ value: asset.RenewalDate }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["SaasProvider"],
//                 objectAttributeValues: [{ value: asset.SaasProvider }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["Category"],
//                 objectAttributeValues: [{ value: asset.Category }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["Key"],
//                 objectAttributeValues: [{ value: asset.Key }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["Created"],
//                 objectAttributeValues: [{ value: asset.Created }]
//             },
//             {
//                 objectTypeAttributeId: attributeIds["Updated"],
//                 objectAttributeValues: [{ value: asset.Updated }]
//             }
//         ];

//         // Prepare payload for the POST request
//         const payload = {
//             objectTypeId: objectTypeId,
//             attributes: attributes
//         };

//         // POST the object along with other attributes
//         const createUrl = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1/object/create`;
//         try {
//             const createResponse = await api.fetch(createUrl, {
//                 method: "POST",
//                 headers: {
//                     ...HEADERS,
//                     "Content-Type": "application/json"
//                 },
//                 body: JSON.stringify(payload)
//             });

//             if (!createResponse.ok) {
//                 const errorResponse = await createResponse.json();
//                 console.error(`Failed to create object for ${asset.Name}:`, createResponse.status, errorResponse);
//             } else {
//                 console.log(`Successfully created object for ${asset.Name}`);
//             }
//         } catch (error) {
//             console.error(`Error creating object for ${asset.Name}:`, error.message);
//         }
//     }
// }

// // ...existing code...

// ...existing code...

// Function to create object type attributes
// ...existing code...

// ...existing code...

// Function to create object type attributes
// ...existing code...

// Function to create object type attributes
async function createObjectTypeAttribute(objectTypeId, attributeName, attributeType = "0", defaultTypeId = "0") {
    const createAttributeUrl = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1/objecttypeattribute/${objectTypeId}`;
    const payload = {
        name: attributeName,
        type: attributeType,
        defaultTypeId: defaultTypeId
    };

    try {
        const response = await api.fetch(createAttributeUrl, {
            method: "POST",
            headers: {
                ...HEADERS,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorResponse = await response.json();
            console.error(`Failed to create attribute ${attributeName} for object type ${objectTypeId}:`, response.status, errorResponse);
            return null;
        } else {
            const responseData = await response.json();
            console.log(`Successfully created attribute ${attributeName} for object type ${objectTypeId}`);
            return responseData.id;
        }
    } catch (error) {
        console.error(`Error creating attribute ${attributeName} for object type ${objectTypeId}:`, error.message);
        return null;
    }
}

// Main function to map and print object types and assets
export async function postObjects(event, context) {
    // Step 1: Fetch object types from JSM
    const objectTypeMap = await getObjectTypeMapping();
    if (!objectTypeMap || Object.keys(objectTypeMap).length === 0) {
        console.error("Failed to fetch object types.");
        return;
    }

    // Print object types and their IDs
    console.log("Object Types and their IDs:");
    for (const [name, id] of Object.entries(objectTypeMap)) {
        console.log(`${name}: ${id}`);
    }

    // Step 2: Read object type names from Confluence (Page ID: 10420225)
    const objectTypeNames = await getConfluenceObjectTypes();
    if (!objectTypeNames || objectTypeNames.length === 0) {
        console.error("No object type names found in Confluence.");
        return;
    }

    // Step 3: Fetch JSON objects from Confluence (Page ID: 10584117)
    const confluenceAssets = await getConfluenceAssets();
    if (!confluenceAssets || confluenceAssets.length === 0) {
        console.error("No assets found in Confluence.");
        return;
    }

    // Step 4: Map and print in required format
    console.log("Mapped list is:");
    for (const asset of confluenceAssets) {
        const objectTypeName = objectTypeNames[0]; // Assume first word in the list defines object type

        if (!objectTypeName || !objectTypeMap[objectTypeName]) {
            console.warn(`No matching object type found for '${objectTypeName}'. Skipping asset:`, asset);
            continue;
        }

        const objectTypeId = objectTypeMap[objectTypeName];

        // Required output format: "{some content} software 130"
        console.log(`${asset.Name} ${objectTypeName} ${objectTypeId}`);

        // Create required attributes for the object type
        const attributeIds = {};
        const attributeNames = ["Name", "Status", "RenewalDate", "SaasProvider", "Category", "Key", "Created", "Updated"];
        for (const attributeName of attributeNames) {
            const attributeId = await createObjectTypeAttribute(objectTypeId, attributeName);
            if (attributeId) {
                attributeIds[attributeName] = attributeId;
            } else {
                console.error(`Failed to create attribute ${attributeName} for object type ${objectTypeId}. Skipping asset:`, asset);
                continue;
            }
        }

        // Prepare attributes for the POST request
        const attributes = [
            {
                objectTypeAttributeId: attributeIds["Name"],
                objectAttributeValues: [{ value: asset.Name }]
            },
            {
                objectTypeAttributeId: attributeIds["Status"],
                objectAttributeValues: [{ value: asset.Status }]
            },
            {
                objectTypeAttributeId: attributeIds["RenewalDate"],
                objectAttributeValues: [{ value: asset.RenewalDate }]
            },
            {
                objectTypeAttributeId: attributeIds["SaasProvider"],
                objectAttributeValues: [{ value: asset.SaasProvider }]
            },
            {
                objectTypeAttributeId: attributeIds["Category"],
                objectAttributeValues: [{ value: asset.Category }]
            },
            {
                objectTypeAttributeId: attributeIds["Key"],
                objectAttributeValues: [{ value: asset.Key }]
            },
            {
                objectTypeAttributeId: attributeIds["Created"],
                objectAttributeValues: [{ value: asset.Created }]
            },
            {
                objectTypeAttributeId: attributeIds["Updated"],
                objectAttributeValues: [{ value: asset.Updated }]
            }
        ];

        // Validate attributes
        const validAttributes = attributes.filter(attr => attr.objectTypeAttributeId && attr.objectAttributeValues[0].value);
        if (validAttributes.length === 0) {
            console.error(`No valid attributes found for ${asset.Name}. Skipping asset.`);
            continue;
        }

        // Prepare payload for the POST request
        const payload = {
            objectTypeId: objectTypeId,
            attributes: validAttributes
        };

        // POST the object along with other attributes
        const createUrl = `https://api.atlassian.com/jsm/assets/workspace/${WORKSPACE_ID}/v1/object/create`;
        try {
            const createResponse = await api.fetch(createUrl, {
                method: "POST",
                headers: {
                    ...HEADERS,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!createResponse.ok) {
                const errorResponse = await createResponse.json();
                console.error(`Failed to create object for ${asset.Name}:`, createResponse.status, errorResponse);
            } else {
                console.log(`Successfully created object for ${asset.Name}`);
            }
        } catch (error) {
            console.error(`Error creating object for ${asset.Name}:`, error.message);
        }
    }
}

// ...existing code...