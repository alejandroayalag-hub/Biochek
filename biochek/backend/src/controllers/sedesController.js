import { pool } from '../db/pool.js';

export async function listSedes(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM sedes ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function createSede(req, res, next) {
  try {
    const { nombre, direccion, lat, lng, radio_metros } = req.body;
    if (!nombre || lat == null || lng == null || radio_metros == null) {
      return res.status(400).json({ error: 'nombre, lat, lng, radio_metros required' });
    }
    const result = await pool.query(
      `INSERT INTO sedes (nombre, direccion, lat, lng, radio_metros)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nombre, direccion || null, lat, lng, radio_metros]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateSede(req, res, next) {
  try {
    const { id } = req.params;
    const { nombre, direccion, lat, lng, radio_metros } = req.body;
    const result = await pool.query(
      `UPDATE sedes SET nombre = $1, direccion = $2, lat = $3, lng = $4, radio_metros = $5
       WHERE id = $6 RETURNING *`,
      [nombre, direccion || null, lat, lng, radio_metros, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteSede(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM sedes WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
