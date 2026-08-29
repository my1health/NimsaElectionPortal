"use client";

import {
  useEffect,
  useState,
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
  const [showLeaderboard, setShowLeaderboard] =
  useState(false);

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

  // ================================
  // ADMIN AUTHENTICATION
  // ================================

  async function checkAdmin() {
    try {
      const db = supabase();

      const {
        data: { user },
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
    } catch (error) {
      console.error(
        "Admin authentication error:",
        error
      );

      router.replace("/admin/login");
    }
  }

  // ================================
  // LOAD NOMINEES + CATEGORIES
  // ================================

  async function loadData() {
    const db = supabase();

    const {
      data: categoryData,
      error: categoryError,
    } = await db
      .from("categories")
      .select("id,name")
      .order("created_at");

    if (categoryError) {
      console.error(categoryError);
    }

    const {
      data: nomineeData,
      error: nomineeError,
    } = await db
      .from("nominees")
      .select(
        "id,name,bio,category_id,is_active,photo_url"
      )
      .order("created_at", {
        ascending: false,
      });

    if (nomineeError) {
      console.error(nomineeError);
    }

    setCategories(categoryData || []);
    setNominees(nomineeData || []);

    if (
      !categoryId &&
      categoryData?.length
    ) {
      setCategoryId(
        categoryData[0].id
      );
    }
  }

  // ================================
  // LOAD STATISTICS
  // ================================

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

  // ================================
  // LOAD RESULTS
  // ================================

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

  useEffect(() => {
    checkAdmin();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================================
  // CLEAR FORM
  // ================================

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

  // ================================
  // PHOTO UPLOAD
  // ================================

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

    const { error } =
      await db.storage
        .from("nominee-photos")
        .upload(
          filename,
          file
        );

    if (error) {
      throw error;
    }

    const { data } =
      db.storage
        .from("nominee-photos")
        .getPublicUrl(
          filename
        );

    return data.publicUrl;
  }

  // ================================
  // SAVE NOMINEE
  // ================================

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

      if (photo) {
        photoUrl =
          await uploadPhoto(
            photo
          );
      }

      if (editing) {
        const { error } =
          await db
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
                photoUrl,
            })
            .eq(
              "id",
              editing.id
            );

        if (error) {
          throw error;
        }

        setMessage(
          "Nominee updated successfully."
        );
      } else {
        const { error } =
          await db
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
                true,
            });

        if (error) {
          throw error;
        }

        setMessage(
          "Nominee added successfully."
        );
      }

      clearForm();

      await Promise.all([
        loadData(),
        loadStats(),
        loadResults(),
      ]);
    } catch (error: any) {
      console.error(
        "Save nominee error:",
        error
      );

      setMessage(
        error?.message ||
          "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  }

  // ================================
  // EDIT NOMINEE
  // ================================

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
      behavior: "smooth",
    });
  }

  // ================================
  // DELETE NOMINEE
  // ================================

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

    const { error } =
      await db
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
      "Nominee deleted successfully."
    );

    await Promise.all([
      loadData(),
      loadStats(),
      loadResults(),
    ]);
  }

  // ================================
  // TOGGLE NOMINEE
  // ================================

  async function toggleNominee(
    nominee: Nominee
  ) {
    const db = supabase();

    const { error } =
      await db
        .from("nominees")
        .update({
          is_active:
            !nominee.is_active,
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

    setMessage(
      nominee.is_active
        ? "Nominee hidden."
        : "Nominee is now visible."
    );

    await Promise.all([
      loadData(),
      loadStats(),
      loadResults(),
    ]);
  }

  // ================================
  // LOGOUT
  // ================================

  async function logout() {
    await supabase()
      .auth
      .signOut();

    router.replace(
      "/admin/login"
    );
  }

  // ================================
  // LOADING SCREEN
  // ================================

  if (
    loading ||
    !authorized
  ) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "#f5f7f6",
          padding: 20,
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: 40,
            borderRadius: 18,
            boxShadow:
              "0 10px 40px rgba(0,0,0,0.08)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 32,
              marginBottom: 15,
            }}
          >
            ✦
          </div>

          <strong>
            NiMSA SE Awards
          </strong>

          <p
            style={{
              color: "#777",
              marginBottom: 0,
            }}
          >
            Checking administrator access...
          </p>
        </div>
      </main>
    );
  }

  // ================================
  // MAIN DASHBOARD
  // ================================

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "#f5f7f6",
        color: "#17231f",
      }}
    >

      {/* ============================
          TOP NAVIGATION
      ============================ */}

      <header
        style={{
          background:
            "#063c2c",
          color: "#fff",
          position:
            "sticky",
          top: 0,
          zIndex: 50,
          boxShadow:
            "0 4px 20px rgba(0,0,0,0.12)",
        }}
      >

        <div
          style={{
            maxWidth: 1250,
            margin: "0 auto",
            padding:
              "16px 22px",
            display: "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
            gap: 20,
          }}
        >

          {/* BRAND */}

          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              gap: 12,
            }}
          >

            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background:
                  "#c9a84e",
                color:
                  "#063c2c",
                display: "flex",
                alignItems:
                  "center",
                justifyContent:
                  "center",
                fontSize: 21,
                fontWeight: 900,
              }}
            >
              N
            </div>

            <div>

              <div
                style={{
                  fontWeight: 800,
                  fontSize: 17,
                }}
              >
                NiMSA SE
              </div>

              <div
                style={{
                  fontSize: 11,
                  opacity: 0.72,
                  letterSpacing:
                    "1.2px",
                }}
              >
                ASCLEPIUS AWARDS 2026
              </div>

            </div>

          </div>


          {/* NAVIGATION */}

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap:
                "wrap",
              justifyContent:
                "flex-end",
            }}
          >

            <button
              onClick={() =>
                router.push("/")
              }
              style={{
                border: "1px solid rgba(255,255,255,.25)",
                background:
                  "transparent",
                color: "#fff",
                padding:
                  "9px 14px",
                borderRadius: 8,
                cursor:
                  "pointer",
              }}
            >
              Public Site
            </button>

            <button
              onClick={logout}
              style={{
                border: "none",
                background:
                  "#fff",
                color:
                  "#063c2c",
                padding:
                  "9px 14px",
                borderRadius: 8,
                fontWeight: 700,
                cursor:
                  "pointer",
              }}
            >
              Logout
            </button>

          </div>

        </div>

      </header>


      {/* ============================
          CONTENT
      ============================ */}

      <div
        style={{
          maxWidth: 1250,
          margin: "0 auto",
          padding:
            "38px 22px 70px",
        }}
      >

        {/* PAGE HEADER */}

        <div
          style={{
            marginBottom: 30,
          }}
        >

          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color:
                "#a17e25",
              letterSpacing:
                "1.5px",
              marginBottom: 7,
            }}
          >
            ADMINISTRATION
          </div>

          <h1
            style={{
              margin:
                "0 0 8px",
              fontSize:
                "clamp(30px, 5vw, 46px)",
              lineHeight: 1.05,
              color:
                "#063c2c",
            }}
          >
            Awards Dashboard
          </h1>

          <p
            style={{
              margin: 0,
              color:
                "#68736f",
              fontSize: 15,
            }}
          >
            Manage nominees, monitor
            payments and view live
            voting results.
          </p>

        </div>


        {/* ============================
            STATISTICS
        ============================ */}

        <section
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 15,
            marginBottom: 35,
          }}
        >

          {/* CATEGORIES */}

          <StatCard
            title="CATEGORIES"
            value={
              statsLoading
                ? "..."
                : stats?.categories ??
                  0
            }
            subtitle="Award categories"
            icon="▦"
          />

          {/* NOMINEES */}

          <StatCard
            title="NOMINEES"
            value={
              statsLoading
                ? "..."
                : stats?.nominees ??
                  0
            }
            subtitle="Total nominees"
            icon="♙"
          />

          {/* ACTIVE */}

          <StatCard
            title="ACTIVE"
            value={
              statsLoading
                ? "..."
                : stats?.activeNominees ??
                  0
            }
            subtitle="Visible nominees"
            icon="✓"
          />

          {/* VOTES */}

          <StatCard
            title="TOTAL VOTES"
            value={
              statsLoading
                ? "..."
                : stats?.votes ??
                  0
            }
            subtitle="Verified votes"
            icon="★"
          />

          {/* PAID */}

          <StatCard
            title="PAID"
            value={
              statsLoading
                ? "..."
                : stats?.successfulPayments ??
                  0
            }
            subtitle="Successful payments"
            icon="₦"
          />

          {/* PENDING */}

          <StatCard
            title="PENDING"
            value={
              statsLoading
                ? "..."
                : stats?.pendingPayments ??
                  0
            }
            subtitle="Awaiting payment"
            icon="◷"
          />

          {/* REVENUE */}

          <StatCard
            title="TOTAL COLLECTED"
            value={
              statsLoading
                ? "..."
                : `₦${(
                    stats?.totalAmountNaira ??
                    0
                  ).toLocaleString()}`
            }
            subtitle="Successful payments"
            icon="₦"
          />

        </section>


        {/* MESSAGE */}

        {message && (
          <div
            style={{
              background:
                "#e9f7ef",
              border:
                "1px solid #b8dfc8",
              color:
                "#17643d",
              padding:
                "13px 16px",
              borderRadius: 10,
              marginBottom: 25,
              fontWeight: 600,
            }}
          >
            {message}
          </div>
        )}


        {/* ============================
            VOTING RESULTS
        ============================ */}

        <section
          style={{
            background:
              "#fff",
            borderRadius: 18,
            padding: 24,
            marginBottom: 30,
            boxShadow:
              "0 6px 25px rgba(0,0,0,0.05)",
            border:
              "1px solid #e8ebe9",
          }}
        >

          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems:
                "center",
              gap: 15,
              flexWrap:
                "wrap",
              marginBottom: 25,
            }}
          >

            <div>

              <div
                style={{
                  color:
                    "#a17e25",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing:
                    "1.4px",
                  marginBottom: 5,
                }}
              >
                LIVE MONITORING
              </div>

              <h2
                style={{
                  margin:
                    "0 0 5px",
                  color:
                    "#063c2c",
                }}
              >
                Voting Results
              </h2>

              <p
                style={{
                  margin: 0,
                  color:
                    "#76817d",
                  fontSize: 14,
                }}
              >
                Verified votes by category.
              </p>

            </div>

            <button
              onClick={() =>
                Promise.all([
                  loadStats(),
                  loadResults(),
                ])
              }
              disabled={
                resultsLoading
              }
              style={{
                background:
                  "#063c2c",
                color: "#fff",
                border: "none",
                padding:
                  "10px 16px",
                borderRadius: 9,
                fontWeight: 700,
                cursor:
                  "pointer",
              }}
            >
              {resultsLoading
                ? "Refreshing..."
                : "↻ Refresh"}
            </button>

          </div>


          {resultsLoading ? (

            <div
              style={{
                padding: 35,
                textAlign:
                  "center",
                color:
                  "#777",
              }}
            >
              Loading voting results...
            </div>

          ) : (

            <div
              style={{
                display:
                  "grid",
                gap: 16,
              }}
            >

              {adminResults.map(
                (category) => (

                  <div
                    key={
                      category.id
                    }
                    style={{
                      border:
                        "1px solid #e6e9e7",
                      borderRadius:
                        14,
                      overflow:
                        "hidden",
                    }}
                  >

                    {/* CATEGORY HEADER */}

                    <div
                      style={{
                        padding:
                          "15px 18px",
                        background:
                          "#f7f9f8",
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        alignItems:
                          "center",
                        gap: 15,
                      }}
                    >

                      <strong
                        style={{
                          color:
                            "#063c2c",
                        }}
                      >
                        {category.name}
                      </strong>

                      <span
                        style={{
                          background:
                            "#063c2c",
                          color:
                            "#fff",
                          borderRadius:
                            20,
                          padding:
                            "5px 11px",
                          fontSize:
                            12,
                          fontWeight:
                            700,
                        }}
                      >
                        {
                          category.totalVotes
                        }{" "}
                        {category.totalVotes ===
                        1
                          ? "vote"
                          : "votes"}
                      </span>

                    </div>


                    {/* NOMINEES */}

                    {category.nominees.length ===
                    0 ? (

                      <div
                        style={{
                          padding:
                            "20px",
                          color:
                            "#8a9390",
                          fontSize:
                            14,
                        }}
                      >
                        No nominees in this
                        category.
                      </div>

                    ) : (

                      <div
                        style={{
                          display:
                            "grid",
                        }}
                      >

                        {category.nominees.map(
                          (
                            nominee,
                            index
                          ) => (

                            <div
                              key={
                                nominee.id
                              }
                              style={{
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                gap: 13,
                                padding:
                                  "13px 18px",
                                borderTop:
                                  "1px solid #eef0ef",
                              }}
                            >

                              {/* RANK */}

                              <strong
                                style={{
                                  width: 30,
                                  color:
                                    index ===
                                    0
                                      ? "#a17e25"
                                      : "#7b8581",
                                }}
                              >
                                #{index + 1}
                              </strong>


                              {/* PHOTO */}

                              {nominee.photo_url ? (

                                <img
                                  src={
                                    nominee.photo_url
                                  }
                                  alt={
                                    nominee.name
                                  }
                                  style={{
                                    width: 46,
                                    height: 46,
                                    borderRadius:
                                      "50%",
                                    objectFit:
                                      "cover",
                                  }}
                                />

                              ) : (

                                <div
                                  style={{
                                    width: 46,
                                    height: 46,
                                    borderRadius:
                                      "50%",
                                    background:
                                      "#e7ece9",
                                    display:
                                      "flex",
                                    alignItems:
                                      "center",
                                    justifyContent:
                                      "center",
                                    fontWeight:
                                      800,
                                    color:
                                      "#063c2c",
                                  }}
                                >
                                  {nominee.name
                                    .charAt(
                                      0
                                    )
                                    .toUpperCase()}
                                </div>

                              )}


                              {/* NAME */}

                              <div
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >

                                <strong>
                                  {
                                    nominee.name
                                  }
                                </strong>

                                <div
                                  style={{
                                    fontSize:
                                      12,
                                    color:
                                      "#8a9390",
                                    marginTop:
                                      2,
                                  }}
                                >
                                  {nominee.is_active
                                    ? "Active"
                                    : "Hidden"}
                                </div>

                              </div>


                              {/* VOTES */}

                              <div
                                style={{
                                  textAlign:
                                    "right",
                                }}
                              >

                                <strong
                                  style={{
                                    fontSize:
                                      19,
                                    color:
                                      "#063c2c",
                                  }}
                                >
                                  {
                                    nominee.votes
                                  }
                                </strong>

                                <div
                                  style={{
                                    fontSize:
                                      10,
                                    color:
                                      "#89918e",
                                    letterSpacing:
                                      "1px",
                                  }}
                                >
                                  VOTES
                                </div>

                              </div>

                            </div>

                          )
                        )}

                      </div>

                    )}

                  </div>

                )
              )}

            </div>

          )}

        </section>


        {/* ============================
            MANAGEMENT AREA
        ============================ */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(300px, 0.85fr) minmax(400px, 1.15fr)",
            gap: 25,
            alignItems:
              "start",
          }}
        >

          {/* ==========================
              ADD / EDIT NOMINEE
          ========================== */}

          <section
            style={{
              background:
                "#fff",
              borderRadius: 18,
              padding: 25,
              boxShadow:
                "0 6px 25px rgba(0,0,0,0.05)",
              border:
                "1px solid #e8ebe9",
            }}
          >

            <div
              style={{
                marginBottom:
                  22,
              }}
            >

              <div
                style={{
                  color:
                    "#a17e25",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing:
                    "1.4px",
                  marginBottom: 5,
                }}
              >
                NOMINEE MANAGEMENT
              </div>

              <h2
                style={{
                  margin:
                    "0 0 5px",
                  color:
                    "#063c2c",
                }}
              >
                {editing
                  ? "Edit Nominee"
                  : "Add Nominee"}
              </h2>

              <p
                style={{
                  margin: 0,
                  color:
                    "#7b8581",
                  fontSize: 14,
                }}
              >
                {editing
                  ? "Update nominee information."
                  : "Add a new nominee to an award category."}
              </p>

            </div>


            <form
              onSubmit={
                saveNominee
              }
            >

              {/* NAME */}

              <label
                style={{
                  display:
                    "block",
                  fontWeight:
                    700,
                  fontSize:
                    13,
                  marginBottom:
                    7,
                }}
              >
                Full Name
              </label>

              <input
                required
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value
                  )
                }
                placeholder="John Doe"
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "12px 13px",
                  border:
                    "1px solid #dfe4e1",
                  borderRadius:
                    9,
                  marginBottom:
                    17,
                  outline:
                    "none",
                }}
              />


              {/* CATEGORY */}

              <label
                style={{
                  display:
                    "block",
                  fontWeight:
                    700,
                  fontSize:
                    13,
                  marginBottom:
                    7,
                }}
              >
                Category
              </label>

              <select
                required
                value={
                  categoryId
                }
                onChange={(e) =>
                  setCategoryId(
                    e.target.value
                  )
                }
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "12px 13px",
                  border:
                    "1px solid #dfe4e1",
                  borderRadius:
                    9,
                  marginBottom:
                    17,
                  background:
                    "#fff",
                }}
              >

                {categories.map(
                  (category) => (
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


              {/* BIO */}

              <label
                style={{
                  display:
                    "block",
                  fontWeight:
                    700,
                  fontSize:
                    13,
                  marginBottom:
                    7,
                }}
              >
                Bio / Description
              </label>

              <textarea
                rows={4}
                value={bio}
                onChange={(e) =>
                  setBio(
                    e.target.value
                  )
                }
                placeholder="Short description of the nominee"
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  padding:
                    "12px 13px",
                  border:
                    "1px solid #dfe4e1",
                  borderRadius:
                    9,
                  marginBottom:
                    17,
                  resize:
                    "vertical",
                }}
              />


              {/* PHOTO */}

              <label
                style={{
                  display:
                    "block",
                  fontWeight:
                    700,
                  fontSize:
                    13,
                  marginBottom:
                    7,
                }}
              >
                Nominee Photo
              </label>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) =>
                  setPhoto(
                    e.target.files?.[0] ||
                      null
                  )
                }
                style={{
                  width:
                    "100%",
                  marginBottom:
                    20,
                }}
              />


              {/* BUTTON */}

              <button
                type="submit"
                disabled={saving}
                style={{
                  width: "100%",
                  border:
                    "none",
                  background:
                    "#063c2c",
                  color: "#fff",
                  padding:
                    "13px 18px",
                  borderRadius:
                    10,
                  fontWeight:
                    800,
                  cursor:
                    "pointer",
                }}
              >
                {saving
                  ? "SAVING..."
                  : editing
                  ? "SAVE CHANGES"
                  : "ADD NOMINEE"}
              </button>


              {editing && (
                <button
                  type="button"
                  onClick={
                    clearForm
                  }
                  style={{
                    width:
                      "100%",
                    marginTop:
                      9,
                    border:
                      "1px solid #d7ddda",
                    background:
                      "#fff",
                    color:
                      "#063c2c",
                    padding:
                      "12px 18px",
                    borderRadius:
                      10,
                    fontWeight:
                      700,
                    cursor:
                      "pointer",
                  }}
                >
                  CANCEL EDIT
                </button>
              )}

            </form>

          </section>


          {/* ==========================
              NOMINEE LIST
          ========================== */}

          <section
            style={{
              background:
                "#fff",
              borderRadius: 18,
              padding: 25,
              boxShadow:
                "0 6px 25px rgba(0,0,0,0.05)",
              border:
                "1px solid #e8ebe9",
            }}
          >

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
                gap: 15,
                marginBottom:
                  22,
              }}
            >

              <div>

                <div
                  style={{
                    color:
                      "#a17e25",
                    fontSize:
                      11,
                    fontWeight:
                      800,
                    letterSpacing:
                      "1.4px",
                    marginBottom:
                      5,
                  }}
                >
                  CURRENT NOMINEES
                </div>

                <h2
                  style={{
                    margin: 0,
                    color:
                      "#063c2c",
                  }}
                >
                  Nominees
                </h2>

              </div>

              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius:
                    "50%",
                  background:
                    "#e9f1ed",
                  color:
                    "#063c2c",
                  display:
                    "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  fontWeight:
                    800,
                }}
              >
                {
                  nominees.length
                }
              </div>

            </div>


            <div
              style={{
                display:
                  "grid",
                gap: 12,
              }}
            >

              {nominees.map(
                (nominee) => (

                  <div
                    key={
                      nominee.id
                    }
                    style={{
                      border:
                        "1px solid #e5e9e7",
                      borderRadius:
                        13,
                      padding:
                        13,
                    }}
                  >

                    <div
                      style={{
                        display:
                          "flex",
                        gap: 13,
                        alignItems:
                          "center",
                      }}
                    >

                      {/* PHOTO */}

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
                              12,
                          }}
                        />

                      ) : (

                        <div
                          style={{
                            width: 65,
                            height: 65,
                            borderRadius:
                              12,
                            background:
                              "#e8eeeb",
                            color:
                              "#063c2c",
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                            fontSize:
                              22,
                            fontWeight:
                              800,
                          }}
                        >
                          {nominee.name
                            .charAt(
                              0
                            )
                            .toUpperCase()}
                        </div>

                      )}


                      {/* INFORMATION */}

                      <div
                        style={{
                          flex: 1,
                          minWidth:
                            0,
                        }}
                      >

                        <strong
                          style={{
                            display:
                              "block",
                            color:
                              "#17231f",
                            fontSize:
                              15,
                          }}
                        >
                          {
                            nominee.name
                          }
                        </strong>

                        <span
                          style={{
                            display:
                              "block",
                            color:
                              "#76817d",
                            fontSize:
                              12,
                            marginTop:
                              3,
                          }}
                        >
                          {
                            categories.find(
                              (c) =>
                                c.id ===
                                nominee.category_id
                            )?.name ||
                            "Unknown category"
                          }
                        </span>

                        <span
                          style={{
                            display:
                              "inline-block",
                            marginTop:
                              5,
                            padding:
                              "3px 8px",
                            borderRadius:
                              20,
                            fontSize:
                              10,
                            fontWeight:
                              800,
                            background:
                              nominee.is_active
                                ? "#e7f5ed"
                                : "#f2f2f2",
                            color:
                              nominee.is_active
                                ? "#17643d"
                                : "#777",
                          }}
                        >
                          {nominee.is_active
                            ? "VISIBLE"
                            : "HIDDEN"}
                        </span>

                      </div>

                    </div>


                    {/* ACTIONS */}

                    <div
                      style={{
                        display:
                          "flex",
                        gap: 7,
                        marginTop:
                          12,
                        flexWrap:
                          "wrap",
                      }}
                    >

                      <button
                        onClick={() =>
                          editNominee(
                            nominee
                          )
                        }
                        style={{
                          flex: 1,
                          minWidth:
                            70,
                          border:
                            "1px solid #d9dfdc",
                          background:
                            "#fff",
                          color:
                            "#063c2c",
                          padding:
                            "8px 10px",
                          borderRadius:
                            8,
                          fontWeight:
                            700,
                          cursor:
                            "pointer",
                        }}
                      >
                        Edit
                      </button>

                      <button
                        onClick={() =>
                          toggleNominee(
                            nominee
                          )
                        }
                        style={{
                          flex: 1,
                          minWidth:
                            70,
                          border:
                            "1px solid #d9dfdc",
                          background:
                            "#f7f9f8",
                          color:
                            "#063c2c",
                          padding:
                            "8px 10px",
                          borderRadius:
                            8,
                          fontWeight:
                            700,
                          cursor:
                            "pointer",
                        }}
                      >
                        {nominee.is_active
                          ? "Hide"
                          : "Show"}
                      </button>

                      <button
                        onClick={() =>
                          deleteNominee(
                            nominee.id
                          )
                        }
                        style={{
                          flex: 1,
                          minWidth:
                            70,
                          border:
                            "1px solid #f0caca",
                          background:
                            "#fff7f7",
                          color:
                            "#b42318",
                          padding:
                            "8px 10px",
                          borderRadius:
                            8,
                          fontWeight:
                            700,
                          cursor:
                            "pointer",
                        }}
                      >
                        Delete
                      </button>

                    </div>

                  </div>

                )
              )}


              {!nominees.length && (
                <div
                  style={{
                    padding:
                      35,
                    textAlign:
                      "center",
                    color:
                      "#7c8581",
                    border:
                      "1px dashed #d7ddda",
                    borderRadius:
                      12,
                  }}
                >
                  No nominees yet.
                  <br />
                  Add the first nominee
                  using the form.
                </div>
              )}

            </div>

          </section>

        </div>


        {/* FOOTER */}

        <footer
          style={{
            marginTop: 50,
            paddingTop: 25,
            borderTop:
              "1px solid #dfe4e1",
            textAlign:
              "center",
            color:
              "#87908c",
            fontSize: 12,
          }}
        >
          NiMSA SE • Asclepius Awards 2026
          • Administration Portal
        </footer>

      </div>

    </main>
  );
}


// ==================================
// STAT CARD COMPONENT
// ==================================

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: string;
}) {
  return (
    <div
      style={{
        background:
          "#fff",
        border:
          "1px solid #e6ebe8",
        borderRadius:
          15,
        padding:
          "18px 17px",
        boxShadow:
          "0 5px 18px rgba(0,0,0,0.04)",
      }}
    >

      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          alignItems:
            "flex-start",
          gap: 10,
        }}
      >

        <div>

          <div
            style={{
              color:
                "#7c8782",
              fontSize:
                10,
              fontWeight:
                800,
              letterSpacing:
                "1.1px",
            }}
          >
            {title}
          </div>

          <div
            style={{
              color:
                "#063c2c",
              fontSize:
                28,
              fontWeight:
                850,
              marginTop:
                5,
              lineHeight:
                1.1,
            }}
          >
            {value}
          </div>

          <div
            style={{
              color:
                "#8a9390",
              fontSize:
                11,
              marginTop:
                4,
            }}
          >
            {subtitle}
          </div>

        </div>


        <div
          style={{
            width: 35,
            height: 35,
            borderRadius:
              10,
            background:
              "#edf3ef",
            color:
              "#063c2c",
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            fontWeight:
              900,
          }}
        >
          {icon}
        </div>

      </div>

    </div>
  );
}
