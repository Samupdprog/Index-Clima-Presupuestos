export type ClientSyncStatus = "pending" | "synced" | "error" | "conflict";

export interface ClientRecord {
  id: string;
  installationId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  holdedContactId: string | null;
  holdedPayloadHash: string | null;
  syncStatus: ClientSyncStatus;
  lastSyncedAt: Date | null;
  syncError: string | null;
  revision: number;
  updatedAt?: Date;
}

export interface CreateClientCommand {
  installationId: string;
  name: string;
  taxId?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
  // Enlace opcional con Holded en el momento de la creación.
  holdedContactId?: string | undefined;
  syncStatus?: ClientSyncStatus | undefined;
  holdedSnapshot?: Record<string, unknown> | undefined;
  holdedPayloadHash?: string | undefined;
  lastSyncedAt?: Date | undefined;
}

export interface UpdateClientCommand {
  installationId: string;
  id: string;
  expectedRevision: number;
  name?: string | undefined;
  taxId?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
}

export interface LinkHoldedInput {
  installationId: string;
  id: string;
  holdedContactId: string;
  holdedSnapshot: Record<string, unknown>;
  holdedPayloadHash: string;
}

/** Refresco desde Holded: Holded manda sobre los campos sincronizados. */
export interface ApplyHoldedSnapshotInput {
  installationId: string;
  id: string;
  holdedContactId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  holdedSnapshot: Record<string, unknown>;
  holdedPayloadHash: string;
}

export interface ClientRepository {
  create(input: CreateClientCommand): Promise<ClientRecord>;
  getById(installationId: string, id: string): Promise<ClientRecord | null>;
  search(installationId: string, query: string): Promise<ClientRecord[]>;
  update(input: UpdateClientCommand): Promise<ClientRecord>;
  findByHoldedContactId(installationId: string, holdedContactId: string): Promise<ClientRecord | null>;
  findByTaxId(installationId: string, taxId: string): Promise<ClientRecord[]>;
  findByEmail(installationId: string, email: string): Promise<ClientRecord[]>;
  linkHolded(input: LinkHoldedInput): Promise<ClientRecord>;
  applyHoldedSnapshot(input: ApplyHoldedSnapshotInput): Promise<ClientRecord>;
  markSyncError(installationId: string, id: string, message: string): Promise<void>;
}

// -------------------------------------------------------------------------
// Puerto del gateway de contactos de Holded (implementado en apps/api sobre
// @quotes/holded). La capa de aplicación sólo ve contactos normalizados.
// -------------------------------------------------------------------------

export interface HoldedClientContact {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** true si el contacto es válido como cliente (no proveedor/acreedor). */
  isClient: boolean;
  /** Objeto remoto completo, para detectar cambios (hash) y merges seguros. */
  snapshot: Record<string, unknown>;
}

export interface HoldedLocalContactInput {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface HoldedContactGateway {
  searchContacts(query: string): Promise<HoldedClientContact[]>;
  getContact(holdedContactId: string): Promise<HoldedClientContact | null>;
  /** Crea el contacto en Holded y devuelve el estado canónico. */
  createFromLocal(input: HoldedLocalContactInput): Promise<HoldedClientContact>;
  /** GET remoto → merge de los campos controlados → PUT completo. */
  applyLocalChanges(holdedContactId: string, changes: HoldedLocalContactInput): Promise<HoldedClientContact>;
}
