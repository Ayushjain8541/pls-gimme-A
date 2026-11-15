import path from 'node:path';
export const dataDir=()=>path.resolve(process.env.DATA_DIR||'.data');
export const dbPath=()=>path.resolve(process.env.DATABASE_PATH||path.join(dataDir(),'app.sqlite'));
export const pythonBin=()=>process.env.PYTHON_BIN||path.resolve('.venv/bin/python');
export function aiConfigured(){return !!(process.env.OPENAI_API_KEY&&process.env.OPENAI_MODEL_INGEST&&process.env.OPENAI_MODEL_FEEDBACK&&process.env.OPENAI_MODEL_CHAT);}
