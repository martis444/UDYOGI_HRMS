--
-- PostgreSQL database dump
--

\restrict lPBKb4pf6DBD1f5jNVgFb9Y3IAHeJ7GVmcpioPbwrrz42yPa0uZQIoLy4YXXjf2

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.locations (id, name, city, state, entity_id, lat, lng, radius_m, pt_state_code, gstn, created_at) FROM stdin;
kol	Corporate HQ	Kolkata	West Bengal	UPPL	22.5726000	88.3639000	300	WB	\N	2026-06-11 12:16:57.684365+05:30
how	Howrah Plant	Howrah	West Bengal	UPPL	22.5958000	88.2636000	500	WB	\N	2026-06-11 12:16:57.684365+05:30
sil	Silvassa Unit	Silvassa	DNH & DD	UPPL	20.2700000	73.0100000	600	NIL	\N	2026-06-11 12:16:57.684365+05:30
dadra	Dadra Unit	Dadra	DNH & DD	USAPL	20.3300000	72.9600000	500	NIL	\N	2026-06-11 12:16:57.684365+05:30
daman	Daman Office	Daman	DNH & DD	UPPL	20.3974000	72.8328000	300	NIL	\N	2026-06-11 12:16:57.684365+05:30
jpr	Jaipur Unit	Jaipur	Rajasthan	UMPL	26.9124000	75.7873000	400	NIL	\N	2026-06-11 12:16:57.684365+05:30
pune	Pune Branch	Pune	Maharashtra	UPPL	18.5204000	73.8567000	300	MH	\N	2026-06-11 12:16:57.684365+05:30
delhi	Delhi Branch	New Delhi	Delhi	UPPL	28.6139000	77.2090000	300	NIL	\N	2026-06-11 12:16:57.684365+05:30
vapi	Vapi Depot	Vapi	Gujarat	UPPL	20.3893000	72.9106000	400	GJ	\N	2026-06-11 12:16:57.684365+05:30
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employees (emp_code, legacy_code, name, father_name, dob, gender, marital_status, blood_group, religion, mobile, email, doj, entity_id, location_id, department_id, division, designation, grade_id, reporting_mgr_code, shift_id, ctc_annual, basic, hra, da, spl, cca, pf_applicable, esic_applicable, pt_applicable, pan, aadhaar_enc, uan, esic_no, bank_name, bank_acc_enc, ifsc, bank_branch, present_addr, present_city, present_state, present_pin, perm_addr, perm_city, perm_state, perm_pin, status, exit_date, created_at, updated_at, created_by, leave_travel, other_allowance, category, probation_days, probation_end_date, is_on_probation, pf_number, conveyance, medical, other_earning) FROM stdin;
US000001	\N	Vikram Singh	\N	\N	male	\N	\N	\N	9810010003	\N	2024-09-10	USAPL	dadra	\N	\N	Store Keeper	\N	\N	\N	\N	8000.00	3000.00	1500.00	500.00	\N	t	t	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-16 19:23:08.65019+05:30	2026-06-16 19:23:08.65019+05:30	UP000001	0.00	0.00	staff	90	\N	t	\N	0.00	0.00	0.00
UP000004	\N	Pooja Patel	\N	\N	female	\N	\N	\N	9810010004	\N	2024-03-20	UPPL	vapi	\N	\N	Machine Operator	\N	\N	\N	\N	7000.00	2500.00	1000.00	500.00	\N	t	t	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-16 19:23:08.687829+05:30	2026-06-16 19:23:08.687829+05:30	UP000001	0.00	0.00	worker	90	\N	t	\N	0.00	0.00	0.00
UP000002	\N	Anil Mehta	\N	\N	male	\N	\N	\N	9810010001	\N	2024-01-15	UPPL	pune	\N	\N	Accounts Officer	\N	\N	\N	\N	12000.00	5000.00	2000.00	1000.00	\N	t	t	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-16 19:23:08.570504+05:30	2026-06-16 19:49:20.61828+05:30	UP000001	0.00	0.00	staff	90	\N	t	\N	0.00	0.00	0.00
UM000001	\N	Ramesh Kumar Singh	Suresh Singh	1990-05-15	male	married	\N	\N	9876543210	ramesh.singh@example.com	2025-01-15	UMPL	jpr	15	\N	Operator	10	\N	1	\N	5542.00	2000.00	1000.00	807.00	0.00	t	t	f	ABCDE1234F	\\xc30d0407030243e5f6440d6f9fa77cd23f010d9b44039e110f7ed1762d46504eec71c325117d039eabd05db140d1c613699d0dac79fa8cbbe768042796f4808c2945c574ab2e1043fff5294feccd94a4	\N	\N	State Bank of India	\\xc30d040703026013b2be2a41014e7cd23a01440c731d03765b7347cf71110c41efe984297bee4e8b9be29b501a09d1d2f71b87f53b5a3206a07a6d980a6d942e8615f07c1b1185b88f3fc1	SBIN0001234	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-11 14:08:46.116515+05:30	2026-06-16 19:21:07.028986+05:30	UP000001	0.00	0.00	staff	90	\N	f	\N	0.00	0.00	0.00
UM000002	\N	Rahul Verma	\N	\N	male	\N	\N	\N	9810010005	\N	2023-02-05	UMPL	jpr	\N	\N	Supervisor	\N	\N	\N	\N	10000.00	4000.00	2000.00	1000.00	0.00	t	t	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-16 19:23:08.725268+05:30	2026-06-17 11:18:34.212275+05:30	UP000001	0.00	0.00	staff	90	\N	t	\N	0.00	0.00	0.00
UP000001	UPPL/2026/00001	Priya Sharma		1990-01-01	female	\N	\N	\N	9800000001	priya@udyogi.in	2020-01-01	UPPL	kol	\N	\N	Senior HR Manager	\N	\N	\N	0.00	30000.00	12000.00	3000.00	0.00	0.00	t	f	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-11 12:16:57.684365+05:30	2026-06-17 11:31:34.269681+05:30	\N	0.00	0.00	staff	90	2026-06-15	f	\N	0.00	0.00	0.00
UP000003	\N	Sunita Rao	\N	\N	female	\N	\N	\N	9810010002	\N	2023-06-01	UPPL	kol	\N	\N	HR Executive	\N	\N	\N	\N	23000.00	10000.00	4000.00	2000.00	0.00	t	f	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	active	\N	2026-06-16 19:23:08.611854+05:30	2026-06-17 12:41:04.597076+05:30	UP000001	0.00	0.00	staff	90	\N	t	\N	0.00	0.00	0.00
\.


--
-- PostgreSQL database dump complete
--

\unrestrict lPBKb4pf6DBD1f5jNVgFb9Y3IAHeJ7GVmcpioPbwrrz42yPa0uZQIoLy4YXXjf2

