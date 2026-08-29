"use client";

import {
  useEffect,
  useState
} from "react";

import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

type Category = {
  id: string;
  name: string;
};

type Nominee = {
  id: string;
  name: string;
  bio: string | null;
  category_id: string;
  is_active: boolean;
  photo_url: string | null;
};
type AdminStats = {
  categories: number;
  nominees: number;
  activeNominees: number;
  votes: number;
  successfulPayments: number;
  pendingPayments: number;
  failedPayments: number;
  totalAmountKobo: number;
  totalAmountNaira: number;
};
type AdminResultNominee = {
  id: string;
  name: string;
  bio: string | null;
  category_id: string;
  photo_url: string | null;
  is_active: boolean;
  votes: number;
};

type AdminResultCategory = {
  id: string;
  name: string;
  nominees: AdminResultNominee[];
  totalVotes: number;
};

export default function AdminPage() {

  const router = useRouter();

  const [authorized, setAuthorized] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [nominees, setNominees] =
    useState<Nominee[]>([]);
  const [stats, setStats] =
  useState<AdminStats | null>(null);

  const [statsLoading, setStatsLoading] =
  useState(true);
  const [adminResults, setAdminResults] =
  useState<AdminResultCategory[]>([]);

  const [resultsLoading, setResultsLoading] =
  useState(true);

  const [name, setName] =
    useState("");

  const [bio, setBio] =
    useState("");

  const [categoryId, setCategoryId] =
    useState("");

  const [photo, setPhoto] =
    useState<File | null>(null);

  const [editing, setEditing] =
    useState<Nominee | null>(null);

  const [message, setMessage] =
    useState("");

  const [saving, setSaving] =
    useState(false);


  // Check admin
  async function checkAdmin() {

    const db = supabase();

    const {
      data: { user }
    } = await db.auth.getUser();

    if (!user) {
      router.replace("/admin/login");
      return;
    }

    const { data: admin } =
      await db
        .from("admins")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

    if (!admin) {

      await db.auth.signOut();

      router.replace("/admin/login");

      return;
    }

    setAuthorized(true);

    await Promise.all([
  loadData(),
  loadStats(),
  loadResults(),
]);

    setLoading(false);
  }


  // Load categories + nominees
  async function loadStats() {
  try {
    setStatsLoading(true);

    const response = await fetch(
      "/api/admin/stats",
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Unable to load dashboard statistics."
      );
    }

    setStats(data.statistics);

  } catch (error: any) {
    console.error(
      "Admin stats error:",
      error
    );

    setMessage(
      error?.message ||
        "Unable to load dashboard statistics."
    );

  } finally {
    setStatsLoading(false);
  }
}
  async function loadResults() {
  try {
    setResultsLoading(true);

    const response = await fetch(
      "/api/admin/results",
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Unable to load voting results."
      );
    }

    setAdminResults(
      data.categories || []
    );

  } catch (error: any) {

    console.error(
      "Admin results error:",
      error
    );

    setMessage(
      error?.message ||
        "Unable to load voting results."
    );

  } finally {
    setResultsLoading(false);
  }
}
  async function loadData() {

    const db = supabase();

    const {
      data: categoryData
    } = await db
      .from("categories")
      .select("id,name")
      .order("created_at");

    const {
      data: nomineeData
    } = await db
      .from("nominees")
      .select(
        "id,name,bio,category_id,is_active,photo_url"
      )
      .order("created_at", {
        ascending: false
      });

    setCategories(
      categoryData || []
    );

    setNominees(
      nomineeData || []
    );

    if (
      !categoryId &&
      categoryData?.length
    ) {
      setCategoryId(
        categoryData[0].id
      );
    }
  }


  useEffect(() => {
    checkAdmin();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function clearForm() {

    setName("");
    setBio("");
    setPhoto(null);
    setEditing(null);

    if (categories[0]) {
      setCategoryId(
        categories[0].id
      );
    }
  }


  async function uploadPhoto(
    file: File
  ) {

    const db = supabase();

    const extension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() || "jpg";

    const filename =
      `${crypto.randomUUID()}.${extension}`;

    const {
      error
    } = await db.storage
      .from("nominee-photos")
      .upload(
        filename,
        file
      );

    if (error) {
      throw error;
    }

    const {
      data
    } = db.storage
      .from("nominee-photos")
      .getPublicUrl(
        filename
      );

    return data.publicUrl;
  }


  async function saveNominee(
    e: React.FormEvent
  ) {

    e.preventDefault();

    setMessage("");

    if (
      !name.trim() ||
      !categoryId
    ) {
      setMessage(
        "Name and category are required."
      );

      return;
    }

    setSaving(true);

    try {

      const db = supabase();

      let photoUrl =
        editing?.photo_url || null;


      // Upload new photo
      if (photo) {

        photoUrl =
          await uploadPhoto(
            photo
          );
      }


      if (editing) {

        const {
          error
        } = await db
          .from("nominees")
          .update({
            name:
              name.trim(),

            bio:
              bio.trim() ||
              null,

            category_id:
              categoryId,

            photo_url:
              photoUrl
          })
          .eq(
            "id",
            editing.id
          );

        if (error)
          throw error;

        setMessage(
          "Nominee updated successfully."
        );

      } else {

        const {
          error
        } = await db
          .from("nominees")
          .insert({
            name:
              name.trim(),

            bio:
              bio.trim() ||
              null,

            category_id:
              categoryId,

            photo_url:
              photoUrl,

            is_active:
              true
          });

        if (error)
          throw error;

        setMessage(
          "Nominee added successfully."
        );
      }

      clearForm();

      await loadData();

    } catch (error: any) {

      setMessage(
        error.message ||
        "Something went wrong."
      );

    } finally {

      setSaving(false);
    }
  }


  function editNominee(
    nominee: Nominee
  ) {

    setEditing(nominee);

    setName(
      nominee.name
    );

    setBio(
      nominee.bio || ""
    );

    setCategoryId(
      nominee.category_id
    );

    setPhoto(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  async function deleteNominee(
    id: string
  ) {

    if (
      !confirm(
        "Delete this nominee? This cannot be undone."
      )
    ) {
      return;
    }

    const db = supabase();

    const {
      error
    } = await db
      .from("nominees")
      .delete()
      .eq(
        "id",
        id
      );

    if (error) {

      setMessage(
        error.message
      );

      return;
    }

    setMessage(
      "Nominee deleted."
    );

    await loadData();
  }


  async function toggleNominee(
    nominee: Nominee
  ) {

    const db = supabase();

    const {
      error
    } = await db
      .from("nominees")
      .update({
        is_active:
          !nominee.is_active
      })
      .eq(
        "id",
        nominee.id
      );

    if (error) {

      setMessage(
        error.message
      );

      return;
    }

    await loadData();
  }


  async function logout() {

    await supabase()
      .auth
      .signOut();

    router.replace(
      "/admin/login"
    );
  }


  if (
    loading ||
    !authorized
  ) {

    return (
      <main className="container section">

        <div className="card">

          Checking administrator access...

        </div>

      </main>
    );
  }


  return (
    <>

      <header className="topbar">

        <div className="container">

          <strong>
            NiMSA Awards Admin
          </strong>

          <div className="adminNav">

            <button
              className="linkBtn"
              onClick={() =>
                router.push("/")
              }
            >
              Public Site
            </button>

            <button
              className="linkBtn"
              onClick={logout}
            >
              Logout
            </button>

          </div>

        </div>

      </header>


      <main className="container section">

        <h1>
          Admin Dashboard
        </h1>

        <p className="muted">
          Add and manage Category B nominees.
        </p>
        {/* =========================
    DASHBOARD STATISTICS
========================= */}

<div
  style={{
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 15,
    marginTop: 30,
    marginBottom: 30,
  }}
>

  {/* CATEGORIES */}

  <div className="card">
    <p className="muted">
      CATEGORIES
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.categories ?? 0}
    </h2>

    <p className="muted">
      Award categories
    </p>
  </div>


  {/* NOMINEES */}

  <div className="card">
    <p className="muted">
      NOMINEES
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.nominees ?? 0}
    </h2>

    <p className="muted">
      Total nominees
    </p>
  </div>


  {/* ACTIVE NOMINEES */}

  <div className="card">
    <p className="muted">
      ACTIVE
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.activeNominees ?? 0}
    </h2>

    <p className="muted">
      Visible nominees
    </p>
  </div>


  {/* TOTAL VOTES */}

  <div className="card">
    <p className="muted">
      TOTAL VOTES
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.votes ?? 0}
    </h2>

    <p className="muted">
      Verified votes
    </p>
  </div>


  {/* SUCCESSFUL PAYMENTS */}

  <div className="card">
    <p className="muted">
      PAID
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.successfulPayments ?? 0}
    </h2>

    <p className="muted">
      Successful payments
    </p>
  </div>


  {/* PENDING PAYMENTS */}

  <div className="card">
    <p className="muted">
      PENDING
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : stats?.pendingPayments ?? 0}
    </h2>

    <p className="muted">
      Pending payments
    </p>
  </div>


  {/* TOTAL REVENUE */}

  <div className="card">
    <p className="muted">
      TOTAL COLLECTED
    </p>

    <h2 style={{ margin: 0 }}>
      {statsLoading
        ? "..."
        : `₦${(
            stats?.totalAmountNaira ?? 0
          ).toLocaleString()}`}
    </h2>

    <p className="muted">
      Successful payments
    </p>
  </div>

</div>


        {message && (
          <div className="notice">
            {message}
          </div>
        )}


        <div className="adminGrid">


          {/* ADD / EDIT FORM */}

          <section className="card form">

            <h2>
              {editing
                ? "Edit Nominee"
                : "Add Nominee"}
            </h2>


            <form
              onSubmit={
                saveNominee
              }
            >

              <label>
                Full Name
              </label>

              <input
                required
                value={name}
                onChange={
                  (e) =>
                    setName(
                      e.target.value
                    )
                }
                placeholder="John Doe"
              />


              <label>
                Category
              </label>

              <select
                required
                value={
                  categoryId
                }
                onChange={
                  (e) =>
                    setCategoryId(
                      e.target.value
                    )
                }
              >

                {categories.map(
                  category => (

                    <option
                      key={
                        category.id
                      }
                      value={
                        category.id
                      }
                    >
                      {
                        category.name
                      }
                    </option>

                  )
                )}

              </select>


              <label>
                Bio / Description
              </label>

              <textarea
                rows={4}
                value={bio}
                onChange={
                  (e) =>
                    setBio(
                      e.target.value
                    )
                }
                placeholder="Short description"
              />


              <label>
                Nominee Photo
              </label>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={
                  (e) =>
                    setPhoto(
                      e.target.files?.[0] ||
                      null
                    )
                }
              />


              <button
                className="primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editing
                  ? "SAVE CHANGES"
                  : "ADD NOMINEE"}
              </button>


              {editing && (

                <button
                  type="button"
                  className="voteBtn close"
                  onClick={
                    clearForm
                  }
                >
                  CANCEL EDIT
                </button>

              )}

            </form>

          </section>


          {/* NOMINEE LIST */}

          <section className="card">

            <h2>
              Nominees (
              {nominees.length}
              )
            </h2>


            <div className="adminList">

              {nominees.map(
                nominee => (

                  <div
                    className="adminItem"
                    key={
                      nominee.id
                    }
                  >

                    <div
                      style={{
                        display:
                          "flex",
                        gap: 12
                      }}
                    >

                      {nominee.photo_url ? (

                        <img
                          src={
                            nominee.photo_url
                          }
                          alt={
                            nominee.name
                          }
                          style={{
                            width: 65,
                            height: 65,
                            objectFit:
                              "cover",
                            borderRadius:
                              10
                          }}
                        />

                      ) : (

                        <div
                          style={{
                            width: 65,
                            height: 65,
                            borderRadius:
                              10,
                            background:
                              "#eee"
                          }}
                        />

                      )}


                      <div>

                        <strong>
                          {
                            nominee.name
                          }
                        </strong>

                        <div className="muted">

                          {
                            categories.find(
                              c =>
                                c.id ===
                                nominee.category_id
                            )?.name ||
                            "Unknown category"
                          }

                        </div>

                        <div className="muted">

                          {
                            nominee.is_active
                              ? "Visible"
                              : "Hidden"
                          }

                        </div>

                      </div>

                    </div>


                    <div
                      style={{
                        display:
                          "flex",
                        gap: 7,
                        flexWrap:
                          "wrap"
                      }}
                    >

                      <button
                        className="smallBtn"
                        onClick={() =>
                          editNominee(
                            nominee
                          )
                        }
                      >
                        Edit
                      </button>

                      <button
                        className="smallBtn"
                        onClick={() =>
                          toggleNominee(
                            nominee
                          )
                        }
                      >
                        {
                          nominee.is_active
                            ? "Hide"
                            : "Show"
                        }
                      </button>

                      <button
                        className="smallBtn danger"
                        onClick={() =>
                          deleteNominee(
                            nominee.id
                          )
                        }
                      >
                        Delete
                      </button>

                    </div>

                  </div>

                )
              )}


              {!nominees.length && (

                <p className="muted">
                  No nominees yet.
                  Add the first nominee.
                </p>

              )}

            </div>

          </section>

        </div>

      </main>

    </>
  );
}
