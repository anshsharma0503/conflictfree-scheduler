import { useDashboard } from "../../hooks/useDashboard";

function ResourcesPage() {
  const {
    user,
    resources,
    resourceFormData,
    editingResourceId,
    resourceError,
    isSavingResource,
    handleResourceFormChange,
    resetResourceForm,
    handleEditResource,
    handleSubmitResource,
    handleDeactivateResource,
  } = useDashboard();

  const rooms = resources.filter((res) => res.type === "room").length;
  const equipment = resources.length - rooms;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <span className="page-kicker">Shared resources</span>
          <h1>Rooms &amp; equipment</h1>
          <p>
            Bookable spaces and kit. A resource can only be held by one meeting at a time, so
            double bookings are blocked.
          </p>
        </div>
      </div>

      <div className="split">
        <section className="panel split-main" style={{ gap: 0 }} aria-labelledby="resource-list-title">
          <div className="panel-header">
            <h2 id="resource-list-title">Active Resources</h2>
            <span className="muted mono">
              {rooms} {rooms === 1 ? "room" : "rooms"} · {equipment} equipment
            </span>
          </div>

          {resources.length ? (
            <div>
              {resources.map((res) => {
                const isOwner = res.createdBy === user?.id;
                const rowClassName =
                  editingResourceId === res.id ? "resource-row is-editing" : "resource-row";

                return (
                  <div className={rowClassName} key={res.id}>
                    <div className="resource-info">
                      <div className="resource-name-line">
                        <span className="resource-card-title">{res.name}</span>
                        <span className="resource-type">{res.type}</span>
                      </div>
                      <div className="resource-meta">
                        <span className="mono">Capacity: {res.capacity}</span>
                        {res.location ? <span>• {res.location}</span> : null}
                      </div>
                      {res.description ? (
                        <p className="resource-description">{res.description}</p>
                      ) : null}
                    </div>

                    {isOwner ? (
                      <div className="button-row">
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => handleEditResource(res)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          type="button"
                          onClick={() => handleDeactivateResource(res.id)}
                        >
                          Deactivate
                        </button>
                      </div>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        Managed by its creator
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">No active resources yet.</p>
          )}
        </section>

        <form
          className="panel split-side"
          style={{ gap: 0 }}
          onSubmit={handleSubmitResource}
          aria-labelledby="resource-form-title"
        >
          <div className="panel-header">
            <h2 id="resource-form-title">
              {editingResourceId ? "Edit resource" : "Add a resource"}
            </h2>
          </div>

          <div className="panel-body">
            <label className="field">
              Resource name
              <input
                name="name"
                type="text"
                value={resourceFormData.name}
                onChange={handleResourceFormChange}
                placeholder="Boardroom A"
                required
              />
            </label>

            <div className="field-row">
              <label className="field">
                Type
                <select
                  name="type"
                  value={resourceFormData.type}
                  onChange={handleResourceFormChange}
                  required
                >
                  <option value="room">Room</option>
                  <option value="equipment">Equipment</option>
                </select>
              </label>
              <label className="field">
                Capacity
                <input
                  name="capacity"
                  type="number"
                  min="1"
                  value={resourceFormData.capacity}
                  onChange={handleResourceFormChange}
                  required
                />
              </label>
            </div>

            <label className="field">
              Resource venue
              <input
                name="location"
                type="text"
                value={resourceFormData.location}
                onChange={handleResourceFormChange}
                placeholder="Floor 3, East wing"
              />
            </label>

            <label className="field">
              Resource details
              <textarea
                name="description"
                value={resourceFormData.description}
                onChange={handleResourceFormChange}
                placeholder="Optional details or amenities"
              />
            </label>

            {resourceError ? (
              <p className="form-error" role="alert">
                {resourceError}
              </p>
            ) : null}
          </div>

          <div className="panel-footer">
            <div style={{ flexGrow: 1 }} />
            {editingResourceId ? (
              <button className="btn" type="button" onClick={resetResourceForm}>
                Cancel edit
              </button>
            ) : null}
            <button className="btn btn-primary" type="submit" disabled={isSavingResource}>
              {isSavingResource
                ? "Saving..."
                : editingResourceId
                  ? "Update resource"
                  : "Create resource"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default ResourcesPage;
