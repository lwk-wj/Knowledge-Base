db = db.getSiblingDB('knowledge_hub');

db.createUser({
    user: "knowledge_hub_user",
    pwd: "knowledge_hub_password",
    roles: [{ role: "readWrite", db: "knowledge_hub" }],
})

db.createCollection('kh_document');
db.createCollection('kh_chunk');