--
-- PostgreSQL database dump
--

-- Dumped from database version 15.14 (Homebrew)
-- Dumped by pg_dump version 18.0

-- Started on 2025-11-07 08:02:31 +04

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 216 (class 1259 OID 16414)
-- Name: investments; Type: TABLE; Schema: public; Owner: 
--

CREATE TABLE public.investments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    property_id uuid,
    amount_invested_aed numeric(20,2) NOT NULL,
    tokens_received bigint NOT NULL,
    xrpl_tx_hash character varying(64),
    created_at timestamp with time zone DEFAULT now()
);

--
-- TOC entry 215 (class 1259 OID 16404)
-- Name: properties; Type: TABLE; Schema: public; Owner: 
--

CREATE TABLE public.properties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    total_value_aed numeric(20,2) NOT NULL,
    tokens_to_issue bigint NOT NULL,
    token_currency_code character varying(40) NOT NULL,
    issuer_address character varying(35) NOT NULL,
    is_fully_funded boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    token_currency_name character varying(40)
);

--
-- TOC entry 217 (class 1259 OID 16431)
-- Name: rental_distributions; Type: TABLE; Schema: public; Owner: 
--

CREATE TABLE public.rental_distributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    property_id uuid,
    total_rent_aed numeric(20,2) NOT NULL,
    distribution_date date NOT NULL,
    xrpl_tx_hash character varying(64),
    created_at timestamp with time zone DEFAULT now(),
    rent_per_token_aed numeric(20,8) DEFAULT 0 NOT NULL
);

--
-- TOC entry 214 (class 1259 OID 16390)
-- Name: users; Type: TABLE; Schema: public; Owner: 
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    fiat_balance_aed numeric(20,2) DEFAULT 0.00,
    xrpl_address character varying(35) NOT NULL,
    xrpl_seed_encrypted text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    password_hash text NOT NULL,
    role character varying(10) DEFAULT 'user'::character varying NOT NULL
);
--
-- TOC entry 3682 (class 2606 OID 16420)
-- Name: investments investments_pkey; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_pkey PRIMARY KEY (id);


--
-- TOC entry 3676 (class 2606 OID 16411)
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- TOC entry 3678 (class 2606 OID 16413)
-- Name: properties properties_token_currency_code_key; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_token_currency_code_key UNIQUE (token_currency_code);


--
-- TOC entry 3680 (class 2606 OID 16448)
-- Name: properties properties_token_currency_name_key; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_token_currency_name_key UNIQUE (token_currency_name);


--
-- TOC entry 3684 (class 2606 OID 16437)
-- Name: rental_distributions rental_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.rental_distributions
    ADD CONSTRAINT rental_distributions_pkey PRIMARY KEY (id);


--
-- TOC entry 3669 (class 2606 OID 16401)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 3671 (class 2606 OID 16399)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3673 (class 2606 OID 16403)
-- Name: users users_xrpl_address_key; Type: CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_xrpl_address_key UNIQUE (xrpl_address);


--
-- TOC entry 3674 (class 1259 OID 16444)
-- Name: idx_properties_token_code; Type: INDEX; Schema: public; Owner: 
--

CREATE INDEX idx_properties_token_code ON public.properties USING btree (token_currency_code);


--
-- TOC entry 3667 (class 1259 OID 16443)
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: 
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- TOC entry 3685 (class 2606 OID 16426)
-- Name: investments investments_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- TOC entry 3686 (class 2606 OID 16421)
-- Name: investments investments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 3687 (class 2606 OID 16438)
-- Name: rental_distributions rental_distributions_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: 
--

ALTER TABLE ONLY public.rental_distributions
    ADD CONSTRAINT rental_distributions_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


-- Completed on 2025-11-07 08:02:32 +04

