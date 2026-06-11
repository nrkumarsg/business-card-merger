import { DriveFile, ParsedCard } from "../types";

// Helper to find a Google Drive folder by name, or optionally create it if absent
export async function findOrCreateFolder(token: string, name: string): Promise<string> {
  try {
    // Search query for un-trashed folders with the given name
    const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name)`;

    const res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to find folder: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      // Folder exists
      return data.files[0].id;
    }

    // Otherwise, create the folder
    const createUrl = "https://www.googleapis.com/drive/v3/files";
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create folder: ${createRes.statusText}`);
    }

    const createdData = await createRes.json();
    return createdData.id;
  } catch (err) {
    console.error("findOrCreateFolder Error:", err);
    throw err;
  }
}

// Fetch images inside a specific parent folder ID
export async function listFilesByFolder(token: string, folderId: string): Promise<DriveFile[]> {
  try {
    const q = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&orderBy=name,createdTime desc&fields=files(id,name,mimeType,thumbnailLink,webContentLink,createdTime,size)&pageSize=100`;

    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to list files inside folder: ${res.statusText}`);
    }

    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error("listFilesByFolder Error:", err);
    throw err;
  }
}

// Download raw Google Drive image as a local binary Blob with OAuth authentication
export async function downloadFileAsBlob(token: string, fileId: string): Promise<Blob> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to download file from Drive: ${res.statusText}`);
  }

  return await res.blob();
}

// Perform a secure, client-side, multi-part binary upload back to Google Drive
export async function uploadMergedCard(
  token: string,
  parentFolderId: string,
  filename: string,
  imageBlob: Blob
): Promise<string> {
  return new Promise((resolve, reject) => {
    const metadata = {
      name: filename,
      mimeType: "image/jpeg",
      parents: [parentFolderId],
    };

    const boundary = "314159265358979323846";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const reader = new FileReader();
    reader.readAsArrayBuffer(imageBlob);
    reader.onload = async () => {
      try {
        const mediaData = reader.result as ArrayBuffer;
        const metadataStr = JSON.stringify(metadata);

        // Stitch multipart payload together
        const encoder = new TextEncoder();
        const part1 = encoder.encode(
          `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n${delimiter}Content-Type: image/jpeg\r\n\r\n`
        );
        const part2 = new Uint8Array(mediaData);
        const part3 = encoder.encode(closeDelimiter);

        const body = new Uint8Array(part1.length + part2.length + part3.length);
        body.set(part1, 0);
        body.set(part2, part1.length);
        body.set(part3, part1.length + part2.length);

        const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: body,
        });

        if (!res.ok) {
          throw new Error(`Failed upload: ${res.statusText}`);
        }

        const data = await res.json();
        resolve(data.id);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
  });
}

// Delete or trash a file in Google Drive (requires user confirmation before invocation)
export async function trashFileFromDrive(token: string, fileId: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to delete card file: ${res.statusText}`);
  }
}

// Publish parsed business card details directly into Google Contacts
export async function saveGoogleContact(token: string, contact: ParsedCard): Promise<any> {
  const url = "https://people.googleapis.com/v1/people:createContact";

  // Split Name into First Name and Last Name if possible
  const nameParts = contact.name.trim().split(/\s+/);
  const givenName = nameParts[0] || "";
  const familyName = nameParts.slice(1).join(" ") || "";

  const payload = {
    names: [
      {
        unstructuredName: contact.name,
        givenName,
        familyName,
      },
    ],
    organizations: [
      {
        name: contact.company || "",
        title: contact.title || "",
      },
    ],
    emailAddresses: contact.emails.map((email) => ({
      value: email,
      type: "work",
    })),
    phoneNumbers: contact.phones.map((phone) => ({
      value: phone,
      type: "work",
    })),
    urls: contact.websites.map((web) => ({
      value: web,
      type: "work",
    })),
    addresses: contact.address
      ? [
          {
            streetAddress: contact.address,
            type: "work",
          },
        ]
      : [],
    biographies: [
      {
        value: `AI Parsed Business Card Contact.\n\nServices/Specialization Notes: ${contact.notes || ""}`,
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to save contact to Google: ${errText || res.statusText}`);
  }

  return await res.json();
}

// Fetch recent Google Contacts from user's account
export async function listGoogleContacts(token: string): Promise<ParsedCard[]> {
  const url = "https://people.googleapis.com/v1/people/me/connections?pageSize=50&personFields=names,organizations,emailAddresses,phoneNumbers,urls,addresses,biographies&sortOrder=LAST_MODIFIED_DESCENDING";
  
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        console.warn("Contacts API returns permissions limit or expired token.");
        return [];
      }
      throw new Error(`Failed to list contacts: ${res.statusText}`);
    }

    const data = await res.json();
    const connections = data.connections || [];

    return connections.map((conn: any) => {
      const name = conn.names?.[0]?.unstructuredName || conn.names?.[0]?.displayName || "Unnamed Contact";
      const company = conn.organizations?.[0]?.name || "";
      const title = conn.organizations?.[0]?.title || "";
      const emails = conn.emailAddresses?.map((e: any) => e.value) || [];
      const phones = conn.phoneNumbers?.map((p: any) => p.value) || [];
      const websites = conn.urls?.map((u: any) => u.value) || [];
      const address = conn.addresses?.[0]?.streetAddress || "";
      const notes = conn.biographies?.[0]?.value || "";

      return {
        name,
        company,
        title,
        emails,
        phones,
        websites,
        address,
        socials: [],
        notes,
      };
    });
  } catch (err) {
    console.error("listGoogleContacts error:", err);
    return [];
  }
}

// Rename a file in Google Drive
export async function renameFileInDrive(token: string, fileId: string, newName: string): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: newName }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to rename file in Drive: ${errorText || res.statusText}`);
  }
}
