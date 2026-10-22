export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _backup_funcoes: {
        Row: {
          definicao: string | null
          nome: string | null
          salvo_em: string | null
        }
        Insert: {
          definicao?: string | null
          nome?: string | null
          salvo_em?: string | null
        }
        Update: {
          definicao?: string | null
          nome?: string | null
          salvo_em?: string | null
        }
        Relationships: []
      }
      ai_agent_settings: {
        Row: {
          active: boolean
          context_enabled: boolean
          created_at: string
          id: string
          model: string
          prompt: string
          temperature: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          context_enabled?: boolean
          created_at?: string
          id?: string
          model?: string
          prompt?: string
          temperature?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          context_enabled?: boolean
          created_at?: string
          id?: string
          model?: string
          prompt?: string
          temperature?: number
          updated_at?: string
        }
        Relationships: []
      }
      aluna_acessos: {
        Row: {
          aluna_id: string
          ativo: boolean
          convite_token: string | null
          created_at: string
          email: string
          id: string
          ultimo_acesso: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          aluna_id: string
          ativo?: boolean
          convite_token?: string | null
          created_at?: string
          email: string
          id?: string
          ultimo_acesso?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          aluna_id?: string
          ativo?: boolean
          convite_token?: string | null
          created_at?: string
          email?: string
          id?: string
          ultimo_acesso?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aluna_acessos_aluna_id_fkey"
            columns: ["aluna_id"]
            isOneToOne: true
            referencedRelation: "alunas"
            referencedColumns: ["id"]
          },
        ]
      }
      alunas: {
        Row: {
          anamnese_mfit: boolean
          avaliacao_enviada: boolean | null
          created_at: string
          data_avaliacao: string | null
          data_cobranca_sinal: string | null
          data_compra: string
          data_fotos_anamnese: string | null
          data_vencimento: string
          deu_sinal: boolean | null
          duracao_plano: string
          forma_pagamento: string
          fotos_anamnese: boolean | null
          id: string
          is_teste: boolean
          liberou_fotos: boolean | null
          liberou_treino_dieta: boolean | null
          nome_completo: string
          origem_lead: string | null
          pago: boolean
          programa: string
          renovacao_recusada: boolean | null
          residuo_pago: boolean | null
          status: string
          telefone: string | null
          updated_at: string
          user_id: string
          valor_sinal: number | null
        }
        Insert: {
          anamnese_mfit?: boolean
          avaliacao_enviada?: boolean | null
          created_at?: string
          data_avaliacao?: string | null
          data_cobranca_sinal?: string | null
          data_compra: string
          data_fotos_anamnese?: string | null
          data_vencimento: string
          deu_sinal?: boolean | null
          duracao_plano: string
          forma_pagamento: string
          fotos_anamnese?: boolean | null
          id?: string
          is_teste?: boolean
          liberou_fotos?: boolean | null
          liberou_treino_dieta?: boolean | null
          nome_completo: string
          origem_lead?: string | null
          pago?: boolean
          programa: string
          renovacao_recusada?: boolean | null
          residuo_pago?: boolean | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id: string
          valor_sinal?: number | null
        }
        Update: {
          anamnese_mfit?: boolean
          avaliacao_enviada?: boolean | null
          created_at?: string
          data_avaliacao?: string | null
          data_cobranca_sinal?: string | null
          data_compra?: string
          data_fotos_anamnese?: string | null
          data_vencimento?: string
          deu_sinal?: boolean | null
          duracao_plano?: string
          forma_pagamento?: string
          fotos_anamnese?: boolean | null
          id?: string
          is_teste?: boolean
          liberou_fotos?: boolean | null
          liberou_treino_dieta?: boolean | null
          nome_completo?: string
          origem_lead?: string | null
          pago?: boolean
          programa?: string
          renovacao_recusada?: boolean | null
          residuo_pago?: boolean | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string
          valor_sinal?: number | null
        }
        Relationships: []
      }
      anamnese_respostas: {
        Row: {
          aceite: boolean
          acompanhamento_nutricional: string | null
          aluna_id: string
          ansiedade: string | null
          bebida_alcoolica: string | null
          capaz_mudanca: number | null
          comentario_treino: string | null
          created_at: string
          data_nascimento: string | null
          define_alimentacao: string | null
          desconta_estresse: string | null
          dias_disponiveis: string | null
          dificuldade_alimentacao: string | null
          dores: string | null
          esforco_diario: string | null
          fuma: string | null
          historico_cardiovascular: string | null
          historico_corpo: string | null
          horas_sono: string | null
          horas_trabalho: string | null
          id: string
          ingestao_doces: string | null
          instagram: string | null
          intestino: string | null
          leva_refeicoes: string | null
          medicacao: string | null
          modelo_corpo: string | null
          nome_completo: string | null
          objetivo_atingido: string | null
          outro_exercicio: string | null
          peso_altura: string | null
          profissao: string | null
          pronta_mudanca: number | null
          qualidade_sono: string | null
          refeicoes_dia: number | null
          respondida_em: string | null
          restricao_alimentar: string | null
          restricao_medica: string | null
          rotina_alimentar: string | null
          status: string
          suplemento: string | null
          suporte_ambiente: number | null
          tempo_sessao: string | null
          token: string
          treina_musculacao: string | null
          treina_musculacao_outro: string | null
          treina_onde: string | null
          tres_incomodos: string | null
          updated_at: string
        }
        Insert: {
          aceite?: boolean
          acompanhamento_nutricional?: string | null
          aluna_id: string
          ansiedade?: string | null
          bebida_alcoolica?: string | null
          capaz_mudanca?: number | null
          comentario_treino?: string | null
          created_at?: string
          data_nascimento?: string | null
          define_alimentacao?: string | null
          desconta_estresse?: string | null
          dias_disponiveis?: string | null
          dificuldade_alimentacao?: string | null
          dores?: string | null
          esforco_diario?: string | null
          fuma?: string | null
          historico_cardiovascular?: string | null
          historico_corpo?: string | null
          horas_sono?: string | null
          horas_trabalho?: string | null
          id?: string
          ingestao_doces?: string | null
          instagram?: string | null
          intestino?: string | null
          leva_refeicoes?: string | null
          medicacao?: string | null
          modelo_corpo?: string | null
          nome_completo?: string | null
          objetivo_atingido?: string | null
          outro_exercicio?: string | null
          peso_altura?: string | null
          profissao?: string | null
          pronta_mudanca?: number | null
          qualidade_sono?: string | null
          refeicoes_dia?: number | null
          respondida_em?: string | null
          restricao_alimentar?: string | null
          restricao_medica?: string | null
          rotina_alimentar?: string | null
          status?: string
          suplemento?: string | null
          suporte_ambiente?: number | null
          tempo_sessao?: string | null
          token?: string
          treina_musculacao?: string | null
          treina_musculacao_outro?: string | null
          treina_onde?: string | null
          tres_incomodos?: string | null
          updated_at?: string
        }
        Update: {
          aceite?: boolean
          acompanhamento_nutricional?: string | null
          aluna_id?: string
          ansiedade?: string | null
          bebida_alcoolica?: string | null
          capaz_mudanca?: number | null
          comentario_treino?: string | null
          created_at?: string
          data_nascimento?: string | null
          define_alimentacao?: string | null
          desconta_estresse?: string | null
          dias_disponiveis?: string | null
          dificuldade_alimentacao?: string | null
          dores?: string | null
          esforco_diario?: string | null
          fuma?: string | null
          historico_cardiovascular?: string | null
          historico_corpo?: string | null
          horas_sono?: string | null
          horas_trabalho?: string | null
          id?: string
          ingestao_doces?: string | null
          instagram?: string | null
          intestino?: string | null
          leva_refeicoes?: string | null
          medicacao?: string | null
          modelo_corpo?: string | null
          nome_completo?: string | null
          objetivo_atingido?: string | null
          outro_exercicio?: string | null
          peso_altura?: string | null
          profissao?: string | null
          pronta_mudanca?: number | null
          qualidade_sono?: string | null
          refeicoes_dia?: number | null
          respondida_em?: string | null
          restricao_alimentar?: string | null
          restricao_medica?: string | null
          rotina_alimentar?: string | null
          status?: string
          suplemento?: string | null
          suporte_ambiente?: number | null
          tempo_sessao?: string | null
          token?: string
          treina_musculacao?: string | null
          treina_musculacao_outro?: string | null
          treina_onde?: string | null
          tres_incomodos?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anamnese_respostas_aluna_id_fkey"
            columns: ["aluna_id"]
            isOneToOne: false
            referencedRelation: "alunas"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      backup_origem_individual_20261015: {
        Row: {
          alterado_em: string
          id: string
          origem_anterior: string
          updated_at_anterior: string | null
        }
        Insert: {
          alterado_em?: string
          id: string
          origem_anterior: string
          updated_at_anterior?: string | null
        }
        Update: {
          alterado_em?: string
          id?: string
          origem_anterior?: string
          updated_at_anterior?: string | null
        }
        Relationships: []
      }
      base_conteudo: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          dados: Json
          perfil: string
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados?: Json
          perfil: string
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          dados?: Json
          perfil?: string
        }
        Relationships: []
      }
      base_leads: {
        Row: {
          criado_origem: string | null
          email: string | null
          id: string
          importado_em: string
          nivel: string | null
          nome: string | null
          origem: string
          origem_id: string
          produto: string | null
          score: number | null
          status: string | null
          tags: string[]
          telefone_e164: string | null
        }
        Insert: {
          criado_origem?: string | null
          email?: string | null
          id?: string
          importado_em?: string
          nivel?: string | null
          nome?: string | null
          origem?: string
          origem_id: string
          produto?: string | null
          score?: number | null
          status?: string | null
          tags?: string[]
          telefone_e164?: string | null
        }
        Update: {
          criado_origem?: string | null
          email?: string | null
          id?: string
          importado_em?: string
          nivel?: string | null
          nome?: string | null
          origem?: string
          origem_id?: string
          produto?: string | null
          score?: number | null
          status?: string | null
          tags?: string[]
          telefone_e164?: string | null
        }
        Relationships: []
      }
      base_leads_segmentos: {
        Row: {
          created_at: string
          criado_por: string | null
          filtro: Json
          id: string
          nome: string
          telefones: string[]
          total: number
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          filtro?: Json
          id?: string
          nome: string
          telefones?: string[]
          total?: number
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          filtro?: Json
          id?: string
          nome?: string
          telefones?: string[]
          total?: number
        }
        Relationships: []
      }
      base_leads_sync_estado: {
        Row: {
          id: number
          ultima_tentativa: string | null
          ultimas_linhas: Json | null
          ultimo_erro: string | null
          ultimo_ok: string | null
        }
        Insert: {
          id?: number
          ultima_tentativa?: string | null
          ultimas_linhas?: Json | null
          ultimo_erro?: string | null
          ultimo_ok?: string | null
        }
        Update: {
          id?: number
          ultima_tentativa?: string | null
          ultimas_linhas?: Json | null
          ultimo_erro?: string | null
          ultimo_ok?: string | null
        }
        Relationships: []
      }
      base_leads_unificada_estado: {
        Row: {
          atualizado_em: string
          id: number
          linhas: number | null
        }
        Insert: {
          atualizado_em?: string
          id?: number
          linhas?: number | null
        }
        Update: {
          atualizado_em?: string
          id?: number
          linhas?: number | null
        }
        Relationships: []
      }
      bkp_wa_mescla_contatos_20261025: {
        Row: {
          contato_id: string
          feito_em: string
          id: number
          linha: Json
          mantido_id: string
          motivo: string
          papel: string
          phone: string
        }
        Insert: {
          contato_id: string
          feito_em?: string
          id?: number
          linha: Json
          mantido_id: string
          motivo: string
          papel: string
          phone: string
        }
        Update: {
          contato_id?: string
          feito_em?: string
          id?: number
          linha?: Json
          mantido_id?: string
          motivo?: string
          papel?: string
          phone?: string
        }
        Relationships: []
      }
      bkp_wa_mescla_mensagens_20261025: {
        Row: {
          feito_em: string
          mensagem_id: string
          phone_antigo: string
          phone_novo: string
        }
        Insert: {
          feito_em?: string
          mensagem_id: string
          phone_antigo: string
          phone_novo: string
        }
        Update: {
          feito_em?: string
          mensagem_id?: string
          phone_antigo?: string
          phone_novo?: string
        }
        Relationships: []
      }
      candidaturas_parceria: {
        Row: {
          checkin: Json
          cidade: string | null
          comunidade: string | null
          contribuicao: string | null
          created_at: string
          id: string
          idade: number | null
          instagram: string | null
          interesse_crescer: number | null
          interesse_formato: string[] | null
          media_comentarios: number | null
          media_stories: number | null
          motivo_interesse: string | null
          nome: string
          notas: string | null
          objetivo: string | null
          observacao: string | null
          publico_cliente: string | null
          quer_parceria: number | null
          rede_ativo: number | null
          retorno_financeiro: string | null
          seguidores: number | null
          slug: string | null
          status: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          checkin?: Json
          cidade?: string | null
          comunidade?: string | null
          contribuicao?: string | null
          created_at?: string
          id?: string
          idade?: number | null
          instagram?: string | null
          interesse_crescer?: number | null
          interesse_formato?: string[] | null
          media_comentarios?: number | null
          media_stories?: number | null
          motivo_interesse?: string | null
          nome: string
          notas?: string | null
          objetivo?: string | null
          observacao?: string | null
          publico_cliente?: string | null
          quer_parceria?: number | null
          rede_ativo?: number | null
          retorno_financeiro?: string | null
          seguidores?: number | null
          slug?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          checkin?: Json
          cidade?: string | null
          comunidade?: string | null
          contribuicao?: string | null
          created_at?: string
          id?: string
          idade?: number | null
          instagram?: string | null
          interesse_crescer?: number | null
          interesse_formato?: string[] | null
          media_comentarios?: number | null
          media_stories?: number | null
          motivo_interesse?: string | null
          nome?: string
          notas?: string | null
          objetivo?: string | null
          observacao?: string | null
          publico_cliente?: string | null
          quer_parceria?: number | null
          rede_ativo?: number | null
          retorno_financeiro?: string | null
          seguidores?: number | null
          slug?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      collaborator_tasks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string
          id: string
          metadata: Json | null
          recurrence: string
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date: string
          id?: string
          metadata?: Json | null
          recurrence?: string
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string
          id?: string
          metadata?: Json | null
          recurrence?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consultations: {
        Row: {
          attended: boolean | null
          attended_at: string | null
          calendly_event_uri: string | null
          calendly_status: string | null
          call_confirmed: boolean | null
          client_email: string | null
          client_name: string
          client_phone: string | null
          closer_observation: string | null
          closer_user_id: string | null
          confirmed_at: string | null
          confirmed_by_user_id: string | null
          converted: boolean | null
          converted_at: string | null
          created_at: string
          date: string
          deletion_reason: string | null
          disqualified: boolean | null
          end_time: string | null
          event_type_name: string | null
          gave_signal: boolean | null
          id: string
          instagram: string | null
          is_future_reschedule: boolean | null
          is_incomplete_flow: boolean | null
          lead_quality: string
          lead_score: number | null
          low_income: boolean | null
          negotiating: boolean | null
          observation: string | null
          passed_pitch_01: boolean | null
          payment_method: string | null
          program_value: string | null
          received_reminder_messages: boolean | null
          refunded: boolean
          refunded_at: string | null
          signal_follow_up_date: string | null
          signal_residue_paid: boolean | null
          signal_value: number | null
          start_time: string | null
          status: string
          ticket_value: number | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          via: string | null
          whatsapp_clicked_at: string | null
        }
        Insert: {
          attended?: boolean | null
          attended_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
          call_confirmed?: boolean | null
          client_email?: string | null
          client_name: string
          client_phone?: string | null
          closer_observation?: string | null
          closer_user_id?: string | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          date: string
          deletion_reason?: string | null
          disqualified?: boolean | null
          end_time?: string | null
          event_type_name?: string | null
          gave_signal?: boolean | null
          id?: string
          instagram?: string | null
          is_future_reschedule?: boolean | null
          is_incomplete_flow?: boolean | null
          lead_quality?: string
          lead_score?: number | null
          low_income?: boolean | null
          negotiating?: boolean | null
          observation?: string | null
          passed_pitch_01?: boolean | null
          payment_method?: string | null
          program_value?: string | null
          received_reminder_messages?: boolean | null
          refunded?: boolean
          refunded_at?: string | null
          signal_follow_up_date?: string | null
          signal_residue_paid?: boolean | null
          signal_value?: number | null
          start_time?: string | null
          status?: string
          ticket_value?: number | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          via?: string | null
          whatsapp_clicked_at?: string | null
        }
        Update: {
          attended?: boolean | null
          attended_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
          call_confirmed?: boolean | null
          client_email?: string | null
          client_name?: string
          client_phone?: string | null
          closer_observation?: string | null
          closer_user_id?: string | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          date?: string
          deletion_reason?: string | null
          disqualified?: boolean | null
          end_time?: string | null
          event_type_name?: string | null
          gave_signal?: boolean | null
          id?: string
          instagram?: string | null
          is_future_reschedule?: boolean | null
          is_incomplete_flow?: boolean | null
          lead_quality?: string
          lead_score?: number | null
          low_income?: boolean | null
          negotiating?: boolean | null
          observation?: string | null
          passed_pitch_01?: boolean | null
          payment_method?: string | null
          program_value?: string | null
          received_reminder_messages?: boolean | null
          refunded?: boolean
          refunded_at?: string | null
          signal_follow_up_date?: string | null
          signal_residue_paid?: boolean | null
          signal_value?: number | null
          start_time?: string | null
          status?: string
          ticket_value?: number | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          via?: string | null
          whatsapp_clicked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultations_closer_user_id_fkey"
            columns: ["closer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conteudo_aulas: {
        Row: {
          capa_url: string | null
          created_at: string
          descricao: string | null
          destaque: boolean
          duracao_segundos: number | null
          id: string
          modulo_id: string
          ordem: number
          publicado: boolean
          tipo: string
          titulo: string
          updated_at: string
          video_path: string | null
          youtube_id: string | null
        }
        Insert: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          duracao_segundos?: number | null
          id?: string
          modulo_id: string
          ordem?: number
          publicado?: boolean
          tipo?: string
          titulo: string
          updated_at?: string
          video_path?: string | null
          youtube_id?: string | null
        }
        Update: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          duracao_segundos?: number | null
          id?: string
          modulo_id?: string
          ordem?: number
          publicado?: boolean
          tipo?: string
          titulo?: string
          updated_at?: string
          video_path?: string | null
          youtube_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conteudo_aulas_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "conteudo_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      conteudo_modulos: {
        Row: {
          capa_url: string | null
          created_at: string
          descricao: string | null
          id: string
          ordem: number
          produto_id: string | null
          programa: string | null
          publicado: boolean
          titulo: string
          updated_at: string
        }
        Insert: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          ordem?: number
          produto_id?: string | null
          programa?: string | null
          publicado?: boolean
          titulo: string
          updated_at?: string
        }
        Update: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          ordem?: number
          produto_id?: string | null
          programa?: string | null
          publicado?: boolean
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteudo_modulos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "conteudo_produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      conteudo_produtos: {
        Row: {
          capa_url: string | null
          created_at: string
          descricao: string | null
          id: string
          ordem: number
          programa: string | null
          publicado: boolean
          titulo: string
          updated_at: string
        }
        Insert: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          ordem?: number
          programa?: string | null
          publicado?: boolean
          titulo: string
          updated_at?: string
        }
        Update: {
          capa_url?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          ordem?: number
          programa?: string | null
          publicado?: boolean
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      conteudo_progresso: {
        Row: {
          aluna_id: string
          aula_id: string
          concluida: boolean
          segundos: number
          updated_at: string
        }
        Insert: {
          aluna_id: string
          aula_id: string
          concluida?: boolean
          segundos?: number
          updated_at?: string
        }
        Update: {
          aluna_id?: string
          aula_id?: string
          concluida?: boolean
          segundos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteudo_progresso_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "conteudo_aulas"
            referencedColumns: ["id"]
          },
        ]
      }
      conteudo_publicacoes: {
        Row: {
          agendado_para: string | null
          agora: boolean
          atualizado_em: string
          card_ref: string
          card_texto: string | null
          conta_id: string
          conta_nome: string | null
          criado_em: string
          criado_por: string | null
          erro: string | null
          id: string
          legenda: string | null
          link_post: string | null
          midias: Json
          perfil: string | null
          publicado_em: string | null
          status: string
          tipo: string
          zernio_post_id: string | null
        }
        Insert: {
          agendado_para?: string | null
          agora?: boolean
          atualizado_em?: string
          card_ref: string
          card_texto?: string | null
          conta_id: string
          conta_nome?: string | null
          criado_em?: string
          criado_por?: string | null
          erro?: string | null
          id?: string
          legenda?: string | null
          link_post?: string | null
          midias?: Json
          perfil?: string | null
          publicado_em?: string | null
          status?: string
          tipo: string
          zernio_post_id?: string | null
        }
        Update: {
          agendado_para?: string | null
          agora?: boolean
          atualizado_em?: string
          card_ref?: string
          card_texto?: string | null
          conta_id?: string
          conta_nome?: string | null
          criado_em?: string
          criado_por?: string | null
          erro?: string | null
          id?: string
          legenda?: string | null
          link_post?: string | null
          midias?: Json
          perfil?: string | null
          publicado_em?: string | null
          status?: string
          tipo?: string
          zernio_post_id?: string | null
        }
        Relationships: []
      }
      conteudo_reacts: {
        Row: {
          atualizado_em: string
          cortar_silencio: boolean
          criado_em: string
          criado_por: string | null
          duracao_final_seg: number | null
          duracao_gravacao_seg: number | null
          duracao_max_seg: number | null
          edicao: Json | null
          edicao_ia: boolean
          erro: string | null
          ia_uso: Json | null
          id: string
          layout: string
          legenda: boolean
          linha_tempo: Json
          modelo_edicao: string | null
          modo: string
          origem_autor: string | null
          origem_url: string | null
          original_bytes: number | null
          original_nome: string | null
          perfil: string | null
          publicacao_id: string | null
          status: string
          titulo: string
        }
        Insert: {
          atualizado_em?: string
          cortar_silencio?: boolean
          criado_em?: string
          criado_por?: string | null
          duracao_final_seg?: number | null
          duracao_gravacao_seg?: number | null
          duracao_max_seg?: number | null
          edicao?: Json | null
          edicao_ia?: boolean
          erro?: string | null
          ia_uso?: Json | null
          id?: string
          layout?: string
          legenda?: boolean
          linha_tempo?: Json
          modelo_edicao?: string | null
          modo?: string
          origem_autor?: string | null
          origem_url?: string | null
          original_bytes?: number | null
          original_nome?: string | null
          perfil?: string | null
          publicacao_id?: string | null
          status?: string
          titulo?: string
        }
        Update: {
          atualizado_em?: string
          cortar_silencio?: boolean
          criado_em?: string
          criado_por?: string | null
          duracao_final_seg?: number | null
          duracao_gravacao_seg?: number | null
          duracao_max_seg?: number | null
          edicao?: Json | null
          edicao_ia?: boolean
          erro?: string | null
          ia_uso?: Json | null
          id?: string
          layout?: string
          legenda?: boolean
          linha_tempo?: Json
          modelo_edicao?: string | null
          modo?: string
          origem_autor?: string | null
          origem_url?: string | null
          original_bytes?: number | null
          original_nome?: string | null
          perfil?: string | null
          publicacao_id?: string | null
          status?: string
          titulo?: string
        }
        Relationships: []
      }
      conteudo_zernio_chave: {
        Row: {
          criado_em: string
          id: number
          pareado_por: string | null
          segredo_hash: string
        }
        Insert: {
          criado_em?: string
          id?: number
          pareado_por?: string | null
          segredo_hash: string
        }
        Update: {
          criado_em?: string
          id?: number
          pareado_por?: string | null
          segredo_hash?: string
        }
        Relationships: []
      }
      crm_acessos: {
        Row: {
          acoes: Json
          areas: Json
          atualizado_em: string
          atualizado_por: string | null
          numeros: string[]
          perfil: string | null
          so_departamentos: boolean
          so_minhas: boolean
          todos_numeros: boolean
          user_id: string
        }
        Insert: {
          acoes?: Json
          areas?: Json
          atualizado_em?: string
          atualizado_por?: string | null
          numeros?: string[]
          perfil?: string | null
          so_departamentos?: boolean
          so_minhas?: boolean
          todos_numeros?: boolean
          user_id: string
        }
        Update: {
          acoes?: Json
          areas?: Json
          atualizado_em?: string
          atualizado_por?: string | null
          numeros?: string[]
          perfil?: string | null
          so_departamentos?: boolean
          so_minhas?: boolean
          todos_numeros?: boolean
          user_id?: string
        }
        Relationships: []
      }
      crm_acessos_padrao: {
        Row: {
          acoes: Json
          areas: Json
          atualizado_em: string
          atualizado_por: string | null
          id: boolean
          numeros: string[]
          so_departamentos: boolean
          so_minhas: boolean
          todos_numeros: boolean
        }
        Insert: {
          acoes?: Json
          areas?: Json
          atualizado_em?: string
          atualizado_por?: string | null
          id?: boolean
          numeros?: string[]
          so_departamentos?: boolean
          so_minhas?: boolean
          todos_numeros?: boolean
        }
        Update: {
          acoes?: Json
          areas?: Json
          atualizado_em?: string
          atualizado_por?: string | null
          id?: boolean
          numeros?: string[]
          so_departamentos?: boolean
          so_minhas?: boolean
          todos_numeros?: boolean
        }
        Relationships: []
      }
      crm_ai_agents: {
        Row: {
          ativacao_humano_horas: number
          ativacao_max_mensagens: number
          ativacao_modo: string
          ativacao_quando: string | null
          ativo: boolean
          atraso_max_segundos: number
          atraso_min_segundos: number
          atraso_segundos: number
          base_conhecimento: string | null
          created_at: string
          debounce_max_segundos: number
          debounce_segundos: number
          descricao: string | null
          dias_semana: number[]
          digitando_cps: number
          digitando_ligado: boolean
          etapas: string[]
          frase_transferencia: string | null
          gatilhos: string[]
          historico_mensagens: number
          horario_fim: string | null
          horario_inicio: string | null
          id: string
          intervalo_max_segundos: number
          intervalo_min_segundos: number
          limite_interacoes: number
          link_agendamento: string | null
          max_falhas: number
          mensagem_fora_horario: string | null
          modelo: string
          nome: string
          numero_id: string | null
          origens: string[]
          palavras_transferencia: string[]
          politicas: string | null
          prompt: string
          prompt_transferencia: string | null
          slug: string
          tags_ao_iniciar: string[]
          temperatura: number
          tipo: string
          transferir_etapa: string | null
          transferir_fluxo_id: string | null
          transferir_para: string | null
          transferir_sem_mensagem: boolean
          transferir_tag: string | null
          updated_at: string
        }
        Insert: {
          ativacao_humano_horas?: number
          ativacao_max_mensagens?: number
          ativacao_modo?: string
          ativacao_quando?: string | null
          ativo?: boolean
          atraso_max_segundos?: number
          atraso_min_segundos?: number
          atraso_segundos?: number
          base_conhecimento?: string | null
          created_at?: string
          debounce_max_segundos?: number
          debounce_segundos?: number
          descricao?: string | null
          dias_semana?: number[]
          digitando_cps?: number
          digitando_ligado?: boolean
          etapas?: string[]
          frase_transferencia?: string | null
          gatilhos?: string[]
          historico_mensagens?: number
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          intervalo_max_segundos?: number
          intervalo_min_segundos?: number
          limite_interacoes?: number
          link_agendamento?: string | null
          max_falhas?: number
          mensagem_fora_horario?: string | null
          modelo?: string
          nome: string
          numero_id?: string | null
          origens?: string[]
          palavras_transferencia?: string[]
          politicas?: string | null
          prompt?: string
          prompt_transferencia?: string | null
          slug: string
          tags_ao_iniciar?: string[]
          temperatura?: number
          tipo?: string
          transferir_etapa?: string | null
          transferir_fluxo_id?: string | null
          transferir_para?: string | null
          transferir_sem_mensagem?: boolean
          transferir_tag?: string | null
          updated_at?: string
        }
        Update: {
          ativacao_humano_horas?: number
          ativacao_max_mensagens?: number
          ativacao_modo?: string
          ativacao_quando?: string | null
          ativo?: boolean
          atraso_max_segundos?: number
          atraso_min_segundos?: number
          atraso_segundos?: number
          base_conhecimento?: string | null
          created_at?: string
          debounce_max_segundos?: number
          debounce_segundos?: number
          descricao?: string | null
          dias_semana?: number[]
          digitando_cps?: number
          digitando_ligado?: boolean
          etapas?: string[]
          frase_transferencia?: string | null
          gatilhos?: string[]
          historico_mensagens?: number
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          intervalo_max_segundos?: number
          intervalo_min_segundos?: number
          limite_interacoes?: number
          link_agendamento?: string | null
          max_falhas?: number
          mensagem_fora_horario?: string | null
          modelo?: string
          nome?: string
          numero_id?: string | null
          origens?: string[]
          palavras_transferencia?: string[]
          politicas?: string | null
          prompt?: string
          prompt_transferencia?: string | null
          slug?: string
          tags_ao_iniciar?: string[]
          temperatura?: number
          tipo?: string
          transferir_etapa?: string | null
          transferir_fluxo_id?: string | null
          transferir_para?: string | null
          transferir_sem_mensagem?: boolean
          transferir_tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_agents_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_ai_agents_transferir_fluxo_fk"
            columns: ["transferir_fluxo_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_ai_conhecimento: {
        Row: {
          agent_id: string
          ativo: boolean
          conteudo: string | null
          created_at: string
          file_name: string | null
          file_path: string | null
          id: string
          ordem: number
          pergunta: string | null
          resposta: string | null
          tipo: string
          titulo: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          ordem?: number
          pergunta?: string | null
          resposta?: string | null
          tipo: string
          titulo?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          ordem?: number
          pergunta?: string | null
          resposta?: string | null
          tipo?: string
          titulo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_conhecimento_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_ai_eventos: {
        Row: {
          agent_id: string | null
          agent_slug: string | null
          contact_phone: string
          created_at: string
          custo_estimado_usd: number | null
          detalhe: string | null
          id: string
          mensagem: string | null
          modelo: string | null
          numero_id: string | null
          tipo: string
          tokens_entrada: number | null
          tokens_saida: number | null
          usuario_id: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_slug?: string | null
          contact_phone: string
          created_at?: string
          custo_estimado_usd?: number | null
          detalhe?: string | null
          id?: string
          mensagem?: string | null
          modelo?: string | null
          numero_id?: string | null
          tipo: string
          tokens_entrada?: number | null
          tokens_saida?: number | null
          usuario_id?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_slug?: string | null
          contact_phone?: string
          created_at?: string
          custo_estimado_usd?: number | null
          detalhe?: string | null
          id?: string
          mensagem?: string | null
          modelo?: string | null
          numero_id?: string | null
          tipo?: string
          tokens_entrada?: number | null
          tokens_saida?: number | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      crm_ai_exemplos: {
        Row: {
          agent_id: string
          ativo: boolean
          contexto: Json
          created_at: string
          criado_por: string | null
          id: string
          mensagem_lead: string
          resposta: string
          resposta_original: string | null
          tipo: string
        }
        Insert: {
          agent_id: string
          ativo?: boolean
          contexto?: Json
          created_at?: string
          criado_por?: string | null
          id?: string
          mensagem_lead: string
          resposta: string
          resposta_original?: string | null
          tipo: string
        }
        Update: {
          agent_id?: string
          ativo?: boolean
          contexto?: Json
          created_at?: string
          criado_por?: string | null
          id?: string
          mensagem_lead?: string
          resposta?: string
          resposta_original?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_exemplos_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_ai_fila: {
        Row: {
          agent_slug: string
          contact_phone: string
          created_at: string
          id: number
          motivo: string | null
          n_mensagens: number
          numero_id: string | null
          pego_em: string | null
          primeira_msg_em: string
          responder_apos: string
          status: string
          tentativas: number
          ultima_msg_em: string
          updated_at: string
        }
        Insert: {
          agent_slug: string
          contact_phone: string
          created_at?: string
          id?: number
          motivo?: string | null
          n_mensagens?: number
          numero_id?: string | null
          pego_em?: string | null
          primeira_msg_em?: string
          responder_apos?: string
          status?: string
          tentativas?: number
          ultima_msg_em?: string
          updated_at?: string
        }
        Update: {
          agent_slug?: string
          contact_phone?: string
          created_at?: string
          id?: number
          motivo?: string | null
          n_mensagens?: number
          numero_id?: string | null
          pego_em?: string | null
          primeira_msg_em?: string
          responder_apos?: string
          status?: string
          tentativas?: number
          ultima_msg_em?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_ai_prompt_versoes: {
        Row: {
          agent_id: string
          created_at: string
          criado_por: string | null
          id: string
          prompt: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          criado_por?: string | null
          id?: string
          prompt: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          criado_por?: string | null
          id?: string
          prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_ai_prompt_versoes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "crm_ai_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_alunas_programa_mapa: {
        Row: {
          atualizado_em: string
          programa: string
          segmento: string
        }
        Insert: {
          atualizado_em?: string
          programa: string
          segmento: string
        }
        Update: {
          atualizado_em?: string
          programa?: string
          segmento?: string
        }
        Relationships: []
      }
      crm_automacao_fila: {
        Row: {
          acoes: Json
          agendado_para: string
          automacao_id: string | null
          campanha_id: string | null
          contact_phone: string
          created_at: string
          enviado_em: string | null
          fluxo_execucao_id: number | null
          fluxo_id: string | null
          gatilho_tipo: string | null
          id: number
          motivo: string | null
          numero_id: string | null
          origem: string
          passo_idx: number | null
          status: string
          tentativas: number
          updated_at: string
          usa_whatsapp: boolean
        }
        Insert: {
          acoes: Json
          agendado_para?: string
          automacao_id?: string | null
          campanha_id?: string | null
          contact_phone: string
          created_at?: string
          enviado_em?: string | null
          fluxo_execucao_id?: number | null
          fluxo_id?: string | null
          gatilho_tipo?: string | null
          id?: never
          motivo?: string | null
          numero_id?: string | null
          origem: string
          passo_idx?: number | null
          status?: string
          tentativas?: number
          updated_at?: string
          usa_whatsapp?: boolean
        }
        Update: {
          acoes?: Json
          agendado_para?: string
          automacao_id?: string | null
          campanha_id?: string | null
          contact_phone?: string
          created_at?: string
          enviado_em?: string | null
          fluxo_execucao_id?: number | null
          fluxo_id?: string | null
          gatilho_tipo?: string | null
          id?: never
          motivo?: string | null
          numero_id?: string | null
          origem?: string
          passo_idx?: number | null
          status?: string
          tentativas?: number
          updated_at?: string
          usa_whatsapp?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_automacao_fila_automacao_id_fkey"
            columns: ["automacao_id"]
            isOneToOne: false
            referencedRelation: "crm_automacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automacao_fila_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "crm_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automacao_fila_fluxo_execucao_id_fkey"
            columns: ["fluxo_execucao_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxo_execucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automacao_fila_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automacao_fila_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automacao_log: {
        Row: {
          automacao_id: string | null
          campanha_id: string | null
          canal: string
          contact_phone: string
          created_at: string
          detalhe: string | null
          fila_id: number | null
          fluxo_id: string | null
          id: number
          message_id: string | null
          numero_id: string | null
          status: string
          tipo: string
        }
        Insert: {
          automacao_id?: string | null
          campanha_id?: string | null
          canal: string
          contact_phone: string
          created_at?: string
          detalhe?: string | null
          fila_id?: number | null
          fluxo_id?: string | null
          id?: never
          message_id?: string | null
          numero_id?: string | null
          status: string
          tipo: string
        }
        Update: {
          automacao_id?: string | null
          campanha_id?: string | null
          canal?: string
          contact_phone?: string
          created_at?: string
          detalhe?: string | null
          fila_id?: number | null
          fluxo_id?: string | null
          id?: never
          message_id?: string | null
          numero_id?: string | null
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automacao_log_fila_id_fkey"
            columns: ["fila_id"]
            isOneToOne: false
            referencedRelation: "crm_automacao_fila"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_automacao_log_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_automacoes: {
        Row: {
          acoes: Json
          ativo: boolean
          created_at: string
          filtro_etapas: string[]
          gatilho_tipo: string
          gatilho_valor: string | null
          id: string
          janela_max_horas: number
          ligado_em: string | null
          nome: string
          numero_id: string | null
          sem_resposta_horas: number | null
          updated_at: string
        }
        Insert: {
          acoes?: Json
          ativo?: boolean
          created_at?: string
          filtro_etapas?: string[]
          gatilho_tipo: string
          gatilho_valor?: string | null
          id?: string
          janela_max_horas?: number
          ligado_em?: string | null
          nome: string
          numero_id?: string | null
          sem_resposta_horas?: number | null
          updated_at?: string
        }
        Update: {
          acoes?: Json
          ativo?: boolean
          created_at?: string
          filtro_etapas?: string[]
          gatilho_tipo?: string
          gatilho_valor?: string | null
          id?: string
          janela_max_horas?: number
          ligado_em?: string | null
          nome?: string
          numero_id?: string | null
          sem_resposta_horas?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_automacoes_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campanhas: {
        Row: {
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          filtro: Json
          id: string
          lote_por_dia: number | null
          nome: string
          numero_id: string | null
          passo_id: string | null
          pausa_motivo: string | null
          roteiro_id: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          filtro?: Json
          id?: string
          lote_por_dia?: number | null
          nome: string
          numero_id?: string | null
          passo_id?: string | null
          pausa_motivo?: string | null
          roteiro_id?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          filtro?: Json
          id?: string
          lote_por_dia?: number | null
          nome?: string
          numero_id?: string | null
          passo_id?: string | null
          pausa_motivo?: string | null
          roteiro_id?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_campanhas_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanhas_passo_id_fkey"
            columns: ["passo_id"]
            isOneToOne: false
            referencedRelation: "crm_roteiro_passos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_campanhas_roteiro_id_fkey"
            columns: ["roteiro_id"]
            isOneToOne: false
            referencedRelation: "crm_roteiros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contato_eventos: {
        Row: {
          contact_phone: string
          created_at: string
          dados: Json | null
          id: number
          tipo: string
          valor: string
        }
        Insert: {
          contact_phone: string
          created_at?: string
          dados?: Json | null
          id?: never
          tipo: string
          valor: string
        }
        Update: {
          contact_phone?: string
          created_at?: string
          dados?: Json | null
          id?: never
          tipo?: string
          valor?: string
        }
        Relationships: []
      }
      crm_departamento_membros: {
        Row: {
          departamento_id: string
          user_id: string
        }
        Insert: {
          departamento_id: string
          user_id: string
        }
        Update: {
          departamento_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_departamento_membros_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "crm_departamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_departamento_numeros: {
        Row: {
          departamento_id: string
          numero_id: string
        }
        Insert: {
          departamento_id: string
          numero_id: string
        }
        Update: {
          departamento_id?: string
          numero_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_departamento_numeros_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "crm_departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_departamento_numeros_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_departamentos: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          etapa_origem: string | null
          fixo: boolean
          id: string
          nome: string
          ordem: number
          origem_id: string | null
          regra: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          etapa_origem?: string | null
          fixo?: boolean
          id?: string
          nome: string
          ordem?: number
          origem_id?: string | null
          regra?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          etapa_origem?: string | null
          fixo?: boolean
          id?: string
          nome?: string
          ordem?: number
          origem_id?: string | null
          regra?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_envio_config: {
        Row: {
          atualizado_em: string
          falhas_seguidas: number
          hora_fim: number
          hora_inicio: number
          intervalo_max: number
          intervalo_min: number
          ligado: boolean
          max_dia: number
          max_hora: number
          numero: string
          numero_id: string | null
          pausado: boolean
          pausado_motivo: string | null
          proximo_envio_em: string | null
        }
        Insert: {
          atualizado_em?: string
          falhas_seguidas?: number
          hora_fim?: number
          hora_inicio?: number
          intervalo_max?: number
          intervalo_min?: number
          ligado?: boolean
          max_dia?: number
          max_hora?: number
          numero?: string
          numero_id?: string | null
          pausado?: boolean
          pausado_motivo?: string | null
          proximo_envio_em?: string | null
        }
        Update: {
          atualizado_em?: string
          falhas_seguidas?: number
          hora_fim?: number
          hora_inicio?: number
          intervalo_max?: number
          intervalo_min?: number
          ligado?: boolean
          max_dia?: number
          max_hora?: number
          numero?: string
          numero_id?: string | null
          pausado?: boolean
          pausado_motivo?: string | null
          proximo_envio_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_envio_config_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_etapas: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          nome: string
          ordem: number
          sistema: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          nome: string
          ordem?: number
          sistema?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          nome?: string
          ordem?: number
          sistema?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_fluxo_base_vistos: {
        Row: {
          chave: string
          contact_phone: string
          fluxo_id: string
          visto_em: string
        }
        Insert: {
          chave: string
          contact_phone: string
          fluxo_id: string
          visto_em?: string
        }
        Update: {
          chave?: string
          contact_phone?: string
          fluxo_id?: string
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_fluxo_base_vistos_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_fluxo_entradas: {
        Row: {
          ativo: boolean
          created_at: string
          fluxo_id: string
          id_publico: string
          janela_inicio: string | null
          janela_qtd: number
          limite_minuto: number
          mapeamento: Json
          origem: string
          segredo_assinatura: string | null
          tags: string[]
          token: string
          total: number
          ultima_amostra: Json | null
          ultima_em: string | null
          ultimo_erro: string | null
          ultimo_status: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          fluxo_id: string
          id_publico?: string
          janela_inicio?: string | null
          janela_qtd?: number
          limite_minuto?: number
          mapeamento?: Json
          origem?: string
          segredo_assinatura?: string | null
          tags?: string[]
          token?: string
          total?: number
          ultima_amostra?: Json | null
          ultima_em?: string | null
          ultimo_erro?: string | null
          ultimo_status?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          fluxo_id?: string
          id_publico?: string
          janela_inicio?: string | null
          janela_qtd?: number
          limite_minuto?: number
          mapeamento?: Json
          origem?: string
          segredo_assinatura?: string | null
          tags?: string[]
          token?: string
          total?: number
          ultima_amostra?: Json | null
          ultima_em?: string | null
          ultimo_erro?: string | null
          ultimo_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_fluxo_entradas_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: true
            referencedRelation: "crm_fluxos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_fluxo_execucoes: {
        Row: {
          aguardando_resposta: boolean
          contact_phone: string
          dados: Json
          fluxo_id: string
          id: number
          iniciado_em: string
          motivo: string | null
          numero_id: string | null
          passo_idx: number
          proximo_em: string
          status: string
          ultimo_envio_em: string | null
          updated_at: string
        }
        Insert: {
          aguardando_resposta?: boolean
          contact_phone: string
          dados?: Json
          fluxo_id: string
          id?: never
          iniciado_em?: string
          motivo?: string | null
          numero_id?: string | null
          passo_idx?: number
          proximo_em?: string
          status?: string
          ultimo_envio_em?: string | null
          updated_at?: string
        }
        Update: {
          aguardando_resposta?: boolean
          contact_phone?: string
          dados?: Json
          fluxo_id?: string
          id?: never
          iniciado_em?: string
          motivo?: string | null
          numero_id?: string | null
          passo_idx?: number
          proximo_em?: string
          status?: string
          ultimo_envio_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_fluxo_execucoes_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_fluxo_execucoes_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_fluxo_pastas: {
        Row: {
          created_at: string
          id: string
          nome: string
          ordem: number
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          ordem?: number
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
        }
        Relationships: []
      }
      crm_fluxos: {
        Row: {
          arvore: Json | null
          ativo: boolean
          canvas: Json
          config: Json
          created_at: string
          descricao: string | null
          excluido_em: string | null
          gatilho_tipo: string
          gatilho_valor: string | null
          gatilhos: Json
          id: string
          ligado_em: string | null
          nome: string
          numero_id: string | null
          origem_ff_workflow_id: string | null
          parar_se_responder: boolean
          passos: Json
          pasta_id: string | null
          permitir_repetir: boolean
          updated_at: string
        }
        Insert: {
          arvore?: Json | null
          ativo?: boolean
          canvas?: Json
          config?: Json
          created_at?: string
          descricao?: string | null
          excluido_em?: string | null
          gatilho_tipo: string
          gatilho_valor?: string | null
          gatilhos?: Json
          id?: string
          ligado_em?: string | null
          nome: string
          numero_id?: string | null
          origem_ff_workflow_id?: string | null
          parar_se_responder?: boolean
          passos?: Json
          pasta_id?: string | null
          permitir_repetir?: boolean
          updated_at?: string
        }
        Update: {
          arvore?: Json | null
          ativo?: boolean
          canvas?: Json
          config?: Json
          created_at?: string
          descricao?: string | null
          excluido_em?: string | null
          gatilho_tipo?: string
          gatilho_valor?: string | null
          gatilhos?: Json
          id?: string
          ligado_em?: string | null
          nome?: string
          numero_id?: string | null
          origem_ff_workflow_id?: string | null
          parar_se_responder?: boolean
          passos?: Json
          pasta_id?: string | null
          permitir_repetir?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_fluxos_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_fluxos_pasta_id_fkey"
            columns: ["pasta_id"]
            isOneToOne: false
            referencedRelation: "crm_fluxo_pastas"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_grupo_links: {
        Row: {
          ativo: boolean
          cliques: number
          nome: string
          slug: string
          tipo: string
          updated_at: string
          url: string | null
        }
        Insert: {
          ativo?: boolean
          cliques?: number
          nome?: string
          slug: string
          tipo?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          ativo?: boolean
          cliques?: number
          nome?: string
          slug?: string
          tipo?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      crm_numeros: {
        Row: {
          apelido: string
          ativo: boolean
          chave: string
          created_at: string
          hora_fim: number
          hora_inicio: number
          id: string
          max_dia: number
          max_hora: number
          observacao: string | null
          ocultar_em_conversas: boolean
          openwa_session_id: string | null
          ordem: number
          robo_ia_ligado: boolean
          robo_ia_max_hora: number
          sessao_openwa: string | null
          telefone: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          apelido: string
          ativo?: boolean
          chave: string
          created_at?: string
          hora_fim?: number
          hora_inicio?: number
          id?: string
          max_dia?: number
          max_hora?: number
          observacao?: string | null
          ocultar_em_conversas?: boolean
          openwa_session_id?: string | null
          ordem?: number
          robo_ia_ligado?: boolean
          robo_ia_max_hora?: number
          sessao_openwa?: string | null
          telefone?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          apelido?: string
          ativo?: boolean
          chave?: string
          created_at?: string
          hora_fim?: number
          hora_inicio?: number
          id?: string
          max_dia?: number
          max_hora?: number
          observacao?: string | null
          ocultar_em_conversas?: boolean
          openwa_session_id?: string | null
          ordem?: number
          robo_ia_ligado?: boolean
          robo_ia_max_hora?: number
          sessao_openwa?: string | null
          telefone?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_roteiro_envios: {
        Row: {
          contact_phone: string
          created_at: string
          enviado_por: string | null
          id: string
          passo_id: string
        }
        Insert: {
          contact_phone: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          passo_id: string
        }
        Update: {
          contact_phone?: string
          created_at?: string
          enviado_por?: string | null
          id?: string
          passo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_roteiro_envios_passo_id_fkey"
            columns: ["passo_id"]
            isOneToOne: false
            referencedRelation: "crm_roteiro_passos"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_roteiro_passos: {
        Row: {
          aguarda_resposta: boolean
          atraso_segundos: number
          conteudo: string
          created_at: string
          file_name: string | null
          id: string
          media_path: string | null
          media_url: string | null
          ordem: number
          roteiro_id: string
          rotulo: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          aguarda_resposta?: boolean
          atraso_segundos?: number
          conteudo?: string
          created_at?: string
          file_name?: string | null
          id?: string
          media_path?: string | null
          media_url?: string | null
          ordem?: number
          roteiro_id: string
          rotulo?: string | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          aguarda_resposta?: boolean
          atraso_segundos?: number
          conteudo?: string
          created_at?: string
          file_name?: string | null
          id?: string
          media_path?: string | null
          media_url?: string | null
          ordem?: number
          roteiro_id?: string
          rotulo?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_roteiro_passos_roteiro_id_fkey"
            columns: ["roteiro_id"]
            isOneToOne: false
            referencedRelation: "crm_roteiros"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_roteiros: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          funil: string
          id: string
          nome: string
          ordem: number
          stage: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          funil?: string
          id?: string
          nome: string
          ordem?: number
          stage: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          funil?: string
          id?: string
          nome?: string
          ordem?: number
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_roteiros_stage_fkey"
            columns: ["stage"]
            isOneToOne: false
            referencedRelation: "crm_etapas"
            referencedColumns: ["slug"]
          },
        ]
      }
      crm_segmentos: {
        Row: {
          ativo: boolean
          created_at: string
          criado_por: string | null
          descricao: string | null
          filtro: Json
          gatilhos: Json
          id: string
          nome: string
          ordem: number
          slug: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          filtro?: Json
          gatilhos?: Json
          id?: string
          nome: string
          ordem?: number
          slug: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          filtro?: Json
          gatilhos?: Json
          id?: string
          nome?: string
          ordem?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_tags: {
        Row: {
          created_at: string
          criado_por: string | null
          nome: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          nome: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          nome?: string
        }
        Relationships: []
      }
      crm_wa_templates: {
        Row: {
          botoes: Json
          cabecalho: Json | null
          categoria: string
          corpo: string
          created_at: string
          idioma: string
          meta_id: string | null
          nome: string
          numero_id: string | null
          origem: string
          rotulos_variaveis: Json
          sincronizado_em: string
          status: string
        }
        Insert: {
          botoes?: Json
          cabecalho?: Json | null
          categoria?: string
          corpo: string
          created_at?: string
          idioma?: string
          meta_id?: string | null
          nome: string
          numero_id?: string | null
          origem?: string
          rotulos_variaveis?: Json
          sincronizado_em?: string
          status?: string
        }
        Update: {
          botoes?: Json
          cabecalho?: Json | null
          categoria?: string
          corpo?: string
          created_at?: string
          idioma?: string
          meta_id?: string | null
          nome?: string
          numero_id?: string | null
          origem?: string
          rotulos_variaveis?: Json
          sincronizado_em?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_wa_templates_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_programs: {
        Row: {
          active: boolean
          created_at: string
          duracao: string
          id: string
          label: string
          price: number
          programa: string
          value: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          duracao?: string
          id?: string
          label: string
          price?: number
          programa?: string
          value: string
        }
        Update: {
          active?: boolean
          created_at?: string
          duracao?: string
          id?: string
          label?: string
          price?: number
          programa?: string
          value?: string
        }
        Relationships: []
      }
      expense_items: {
        Row: {
          category: string
          created_at: string
          date: string | null
          id: string
          month: string
          name: string
          recurring: boolean
          value: number
        }
        Insert: {
          category: string
          created_at?: string
          date?: string | null
          id?: string
          month: string
          name?: string
          recurring?: boolean
          value?: number
        }
        Update: {
          category?: string
          created_at?: string
          date?: string | null
          id?: string
          month?: string
          name?: string
          recurring?: boolean
          value?: number
        }
        Relationships: []
      }
      feedback_semanal_responses: {
        Row: {
          aluna_id: string | null
          cardio_intensidade: number | null
          cardio_minutos_semanais: string | null
          consultoria_feedback: string | null
          consultoria_sente_falta: string | null
          created_at: string
          dieta_adesao: number | null
          dieta_beliscando: string | null
          dieta_nota: number | null
          dieta_refeicoes_fora: string | null
          id: string
          maior_gargalo: string | null
          mudanca_descricao: string | null
          nome: string
          percebe_mudanca: string | null
          periodicidade: string | null
          produto: string | null
          programa_indicaria: number | null
          resumo_ia: string | null
          resumo_ia_at: string | null
          telefone: string | null
          treino_execucao: number | null
          treino_frequencia_semanal: string | null
          treino_minutos_semanais: string | null
          treino_progressao_carga: number | null
          treino_reps_reserva: string | null
          treino_series_validas: number | null
        }
        Insert: {
          aluna_id?: string | null
          cardio_intensidade?: number | null
          cardio_minutos_semanais?: string | null
          consultoria_feedback?: string | null
          consultoria_sente_falta?: string | null
          created_at?: string
          dieta_adesao?: number | null
          dieta_beliscando?: string | null
          dieta_nota?: number | null
          dieta_refeicoes_fora?: string | null
          id?: string
          maior_gargalo?: string | null
          mudanca_descricao?: string | null
          nome: string
          percebe_mudanca?: string | null
          periodicidade?: string | null
          produto?: string | null
          programa_indicaria?: number | null
          resumo_ia?: string | null
          resumo_ia_at?: string | null
          telefone?: string | null
          treino_execucao?: number | null
          treino_frequencia_semanal?: string | null
          treino_minutos_semanais?: string | null
          treino_progressao_carga?: number | null
          treino_reps_reserva?: string | null
          treino_series_validas?: number | null
        }
        Update: {
          aluna_id?: string | null
          cardio_intensidade?: number | null
          cardio_minutos_semanais?: string | null
          consultoria_feedback?: string | null
          consultoria_sente_falta?: string | null
          created_at?: string
          dieta_adesao?: number | null
          dieta_beliscando?: string | null
          dieta_nota?: number | null
          dieta_refeicoes_fora?: string | null
          id?: string
          maior_gargalo?: string | null
          mudanca_descricao?: string | null
          nome?: string
          percebe_mudanca?: string | null
          periodicidade?: string | null
          produto?: string | null
          programa_indicaria?: number | null
          resumo_ia?: string | null
          resumo_ia_at?: string | null
          telefone?: string | null
          treino_execucao?: number | null
          treino_frequencia_semanal?: string | null
          treino_minutos_semanais?: string | null
          treino_progressao_carga?: number | null
          treino_reps_reserva?: string | null
          treino_series_validas?: number | null
        }
        Relationships: []
      }
      feedback_substituicoes: {
        Row: {
          alimentos: string[] | null
          criado_em: string
          id: string
          modo: string | null
          nao_achou: string | null
          nota: number
          sugestao: string | null
          trocas: string[] | null
        }
        Insert: {
          alimentos?: string[] | null
          criado_em?: string
          id?: string
          modo?: string | null
          nao_achou?: string | null
          nota: number
          sugestao?: string | null
          trocas?: string[] | null
        }
        Update: {
          alimentos?: string[] | null
          criado_em?: string
          id?: string
          modo?: string | null
          nao_achou?: string | null
          nota?: number
          sugestao?: string | null
          trocas?: string[] | null
        }
        Relationships: []
      }
      fullfunnel_envios: {
        Row: {
          atualizado_em: string
          criado_em: string
          erro: string | null
          http_status: number | null
          id: number
          lead_id: string | null
          payload: Json
          request_id: number | null
          status: string
          telefone_e164: string | null
          tentativas: number
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          erro?: string | null
          http_status?: number | null
          id?: never
          lead_id?: string | null
          payload: Json
          request_id?: number | null
          status?: string
          telefone_e164?: string | null
          tentativas?: number
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          erro?: string | null
          http_status?: number | null
          id?: never
          lead_id?: string | null
          payload?: Json
          request_id?: number | null
          status?: string
          telefone_e164?: string | null
          tentativas?: number
        }
        Relationships: [
          {
            foreignKeyName: "fullfunnel_envios_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_form_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          active: boolean
          created_at: string
          destination_url: string | null
          id: string
          name: string
          notes: string | null
          parent_id: string | null
          slug: string
          tracked_url: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          destination_url?: string | null
          id?: string
          name: string
          notes?: string | null
          parent_id?: string | null
          slug: string
          tracked_url?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          destination_url?: string | null
          id?: string
          name?: string
          notes?: string | null
          parent_id?: string | null
          slug?: string
          tracked_url?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnels_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_api_keys: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          nome: string
          revoked_at: string | null
          ultimo_uso: string | null
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          nome: string
          revoked_at?: string | null
          ultimo_uso?: string | null
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          nome?: string
          revoked_at?: string | null
          ultimo_uso?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gateway_config: {
        Row: {
          api_key_externa: string | null
          created_at: string
          dados_bancarios: Json | null
          email_notificacoes: string | null
          logo_url: string | null
          nome_empresa: string | null
          taxa_boleto: number
          taxa_cartao_parcelado: number
          taxa_cartao_vista: number
          taxa_fixa: number
          taxa_pix: number
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          api_key_externa?: string | null
          created_at?: string
          dados_bancarios?: Json | null
          email_notificacoes?: string | null
          logo_url?: string | null
          nome_empresa?: string | null
          taxa_boleto?: number
          taxa_cartao_parcelado?: number
          taxa_cartao_vista?: number
          taxa_fixa?: number
          taxa_pix?: number
          updated_at?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          api_key_externa?: string | null
          created_at?: string
          dados_bancarios?: Json | null
          email_notificacoes?: string | null
          logo_url?: string | null
          nome_empresa?: string | null
          taxa_boleto?: number
          taxa_cartao_parcelado?: number
          taxa_cartao_vista?: number
          taxa_fixa?: number
          taxa_pix?: number
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      gateway_links: {
        Row: {
          ativo: boolean
          cor_tema: string
          created_at: string
          descricao: string | null
          id: string
          imagem_url: string | null
          metodos_aceitos: Json
          nome_produto: string
          parcelamento_max: number
          slug: string
          total_arrecadado: number
          updated_at: string
          user_id: string
          valor: number
          vendas_count: number
        }
        Insert: {
          ativo?: boolean
          cor_tema?: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          metodos_aceitos?: Json
          nome_produto: string
          parcelamento_max?: number
          slug: string
          total_arrecadado?: number
          updated_at?: string
          user_id: string
          valor: number
          vendas_count?: number
        }
        Update: {
          ativo?: boolean
          cor_tema?: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          metodos_aceitos?: Json
          nome_produto?: string
          parcelamento_max?: number
          slug?: string
          total_arrecadado?: number
          updated_at?: string
          user_id?: string
          valor?: number
          vendas_count?: number
        }
        Relationships: []
      }
      gateway_saques: {
        Row: {
          created_at: string
          dados_bancarios: Json | null
          id: string
          observacao: string | null
          processado_em: string | null
          status: string
          updated_at: string
          user_id: string
          valor: number
        }
        Insert: {
          created_at?: string
          dados_bancarios?: Json | null
          id?: string
          observacao?: string | null
          processado_em?: string | null
          status?: string
          updated_at?: string
          user_id: string
          valor: number
        }
        Update: {
          created_at?: string
          dados_bancarios?: Json | null
          id?: string
          observacao?: string | null
          processado_em?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          valor?: number
        }
        Relationships: []
      }
      gateway_transacoes: {
        Row: {
          capture_method: string | null
          cliente_cpf_cnpj: string | null
          cliente_email: string
          cliente_nome: string
          cliente_telefone: string | null
          codigo_barras: string | null
          copy_origem: string | null
          created_at: string
          descricao: string | null
          gateway_id: string | null
          id: string
          invoice_slug: string | null
          link_id: string | null
          link_pagamento: string | null
          metodo: string
          order_nsu: string | null
          pago_em: string | null
          paid_amount: number | null
          parcelas: number
          qr_code: string | null
          receipt_url: string | null
          status: string
          taxa_fixa: number
          taxa_percentual: number
          transaction_nsu: string | null
          updated_at: string
          user_id: string
          valor_bruto: number
          valor_liquido: number
          vencimento: string | null
        }
        Insert: {
          capture_method?: string | null
          cliente_cpf_cnpj?: string | null
          cliente_email: string
          cliente_nome: string
          cliente_telefone?: string | null
          codigo_barras?: string | null
          copy_origem?: string | null
          created_at?: string
          descricao?: string | null
          gateway_id?: string | null
          id?: string
          invoice_slug?: string | null
          link_id?: string | null
          link_pagamento?: string | null
          metodo: string
          order_nsu?: string | null
          pago_em?: string | null
          paid_amount?: number | null
          parcelas?: number
          qr_code?: string | null
          receipt_url?: string | null
          status?: string
          taxa_fixa?: number
          taxa_percentual?: number
          transaction_nsu?: string | null
          updated_at?: string
          user_id: string
          valor_bruto: number
          valor_liquido: number
          vencimento?: string | null
        }
        Update: {
          capture_method?: string | null
          cliente_cpf_cnpj?: string | null
          cliente_email?: string
          cliente_nome?: string
          cliente_telefone?: string | null
          codigo_barras?: string | null
          copy_origem?: string | null
          created_at?: string
          descricao?: string | null
          gateway_id?: string | null
          id?: string
          invoice_slug?: string | null
          link_id?: string | null
          link_pagamento?: string | null
          metodo?: string
          order_nsu?: string | null
          pago_em?: string | null
          paid_amount?: number | null
          parcelas?: number
          qr_code?: string | null
          receipt_url?: string | null
          status?: string
          taxa_fixa?: number
          taxa_percentual?: number
          transaction_nsu?: string | null
          updated_at?: string
          user_id?: string
          valor_bruto?: number
          valor_liquido?: number
          vencimento?: string | null
        }
        Relationships: []
      }
      gateway_webhook_logs: {
        Row: {
          id: string
          notes: string | null
          order_nsu: string | null
          payload: Json
          received_at: string
          transaction_nsu: string | null
          validation_result: string
        }
        Insert: {
          id?: string
          notes?: string | null
          order_nsu?: string | null
          payload?: Json
          received_at?: string
          transaction_nsu?: string | null
          validation_result?: string
        }
        Update: {
          id?: string
          notes?: string | null
          order_nsu?: string | null
          payload?: Json
          received_at?: string
          transaction_nsu?: string | null
          validation_result?: string
        }
        Relationships: []
      }
      grupos_campanha_grupos: {
        Row: {
          anuncio: boolean | null
          ativo: boolean
          boas_vindas_em: string | null
          campanha_id: string
          chat_id: string | null
          cheio: boolean
          cliques: number
          cliques_na_contagem: number
          created_at: string
          criado_pelo_crm: boolean
          entradas: number
          id: string
          importado: boolean
          link_convite: string | null
          nome: string
          ordem: number
          participantes: number | null
          participantes_em: string | null
          permissao_em: string | null
          peso: number
          saidas: number
          sou_admin: boolean | null
          travado: boolean | null
        }
        Insert: {
          anuncio?: boolean | null
          ativo?: boolean
          boas_vindas_em?: string | null
          campanha_id: string
          chat_id?: string | null
          cheio?: boolean
          cliques?: number
          cliques_na_contagem?: number
          created_at?: string
          criado_pelo_crm?: boolean
          entradas?: number
          id?: string
          importado?: boolean
          link_convite?: string | null
          nome?: string
          ordem?: number
          participantes?: number | null
          participantes_em?: string | null
          permissao_em?: string | null
          peso?: number
          saidas?: number
          sou_admin?: boolean | null
          travado?: boolean | null
        }
        Update: {
          anuncio?: boolean | null
          ativo?: boolean
          boas_vindas_em?: string | null
          campanha_id?: string
          chat_id?: string | null
          cheio?: boolean
          cliques?: number
          cliques_na_contagem?: number
          created_at?: string
          criado_pelo_crm?: boolean
          entradas?: number
          id?: string
          importado?: boolean
          link_convite?: string | null
          nome?: string
          ordem?: number
          participantes?: number | null
          participantes_em?: string | null
          permissao_em?: string | null
          peso?: number
          saidas?: number
          sou_admin?: boolean | null
          travado?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "grupos_campanha_grupos_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanhas"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_campanhas: {
        Row: {
          admins_telefones: string[]
          auto_criar: boolean
          avulsa: boolean
          boas_vindas_intervalo_min: number
          boas_vindas_ligada: boolean
          boas_vindas_mencionar: boolean
          boas_vindas_texto: string | null
          created_at: string
          criacao_agendada_para: string | null
          criacao_bloqueio: string | null
          criacao_bloqueio_em: string | null
          criacao_falhas_seguidas: number
          criacao_retomar_em: string | null
          criacao_ultimo_erro: string | null
          criado_por: string | null
          data_evento: string | null
          descricao_grupo: string | null
          disparos_pausados: boolean
          encerrada: boolean
          folga_vagas: number
          foto_path: string | null
          id: string
          intervalo_max_s: number
          intervalo_min_s: number
          limite_por_grupo: number
          link_pausado: boolean
          max_grupos: number
          modo_distribuicao: string
          nome: string
          numero_id: string | null
          prefixo_nome: string
          projeto: string | null
          proximo_numero: number
          slug: string
          so_admins_editam: boolean
          so_admins_enviam: boolean
          tag: string
          teto_por_minuto: number
          updated_at: string
          url_lotado: string | null
        }
        Insert: {
          admins_telefones?: string[]
          auto_criar?: boolean
          avulsa?: boolean
          boas_vindas_intervalo_min?: number
          boas_vindas_ligada?: boolean
          boas_vindas_mencionar?: boolean
          boas_vindas_texto?: string | null
          created_at?: string
          criacao_agendada_para?: string | null
          criacao_bloqueio?: string | null
          criacao_bloqueio_em?: string | null
          criacao_falhas_seguidas?: number
          criacao_retomar_em?: string | null
          criacao_ultimo_erro?: string | null
          criado_por?: string | null
          data_evento?: string | null
          descricao_grupo?: string | null
          disparos_pausados?: boolean
          encerrada?: boolean
          folga_vagas?: number
          foto_path?: string | null
          id?: string
          intervalo_max_s?: number
          intervalo_min_s?: number
          limite_por_grupo?: number
          link_pausado?: boolean
          max_grupos?: number
          modo_distribuicao?: string
          nome: string
          numero_id?: string | null
          prefixo_nome?: string
          projeto?: string | null
          proximo_numero?: number
          slug: string
          so_admins_editam?: boolean
          so_admins_enviam?: boolean
          tag?: string
          teto_por_minuto?: number
          updated_at?: string
          url_lotado?: string | null
        }
        Update: {
          admins_telefones?: string[]
          auto_criar?: boolean
          avulsa?: boolean
          boas_vindas_intervalo_min?: number
          boas_vindas_ligada?: boolean
          boas_vindas_mencionar?: boolean
          boas_vindas_texto?: string | null
          created_at?: string
          criacao_agendada_para?: string | null
          criacao_bloqueio?: string | null
          criacao_bloqueio_em?: string | null
          criacao_falhas_seguidas?: number
          criacao_retomar_em?: string | null
          criacao_ultimo_erro?: string | null
          criado_por?: string | null
          data_evento?: string | null
          descricao_grupo?: string | null
          disparos_pausados?: boolean
          encerrada?: boolean
          folga_vagas?: number
          foto_path?: string | null
          id?: string
          intervalo_max_s?: number
          intervalo_min_s?: number
          limite_por_grupo?: number
          link_pausado?: boolean
          max_grupos?: number
          modo_distribuicao?: string
          nome?: string
          numero_id?: string | null
          prefixo_nome?: string
          projeto?: string | null
          proximo_numero?: number
          slug?: string
          so_admins_editam?: boolean
          so_admins_enviam?: boolean
          tag?: string
          teto_por_minuto?: number
          updated_at?: string
          url_lotado?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grupos_campanhas_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_cliques: {
        Row: {
          campanha_id: string
          created_at: string
          espera_token: string | null
          esperou: boolean
          grupo_id: string | null
          id: number
          resultado: string
          telefone_e164: string | null
          utm: Json
        }
        Insert: {
          campanha_id: string
          created_at?: string
          espera_token?: string | null
          esperou?: boolean
          grupo_id?: string | null
          id?: never
          resultado?: string
          telefone_e164?: string | null
          utm?: Json
        }
        Update: {
          campanha_id?: string
          created_at?: string
          espera_token?: string | null
          esperou?: boolean
          grupo_id?: string | null
          id?: never
          resultado?: string
          telefone_e164?: string | null
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "grupos_cliques_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_cliques_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanha_grupos"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_criacoes: {
        Row: {
          avisos: string[]
          campanha_id: string
          chat_id: string | null
          created_at: string
          erro: string | null
          etapa: string
          grupo_id: string | null
          id: string
          nome: string
          numero: number
          status: string
          tentativas: number
          updated_at: string
        }
        Insert: {
          avisos?: string[]
          campanha_id: string
          chat_id?: string | null
          created_at?: string
          erro?: string | null
          etapa?: string
          grupo_id?: string | null
          id?: string
          nome: string
          numero: number
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Update: {
          avisos?: string[]
          campanha_id?: string
          chat_id?: string | null
          created_at?: string
          erro?: string | null
          etapa?: string
          grupo_id?: string | null
          id?: string
          nome?: string
          numero?: number
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_criacoes_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_criacoes_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanha_grupos"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_disparo_estado: {
        Row: {
          id: number
          trava_ate: string | null
          ultimo_resultado: Json | null
          ultimo_tick: string | null
        }
        Insert: {
          id?: number
          trava_ate?: string | null
          ultimo_resultado?: Json | null
          ultimo_tick?: string | null
        }
        Update: {
          id?: number
          trava_ate?: string | null
          ultimo_resultado?: Json | null
          ultimo_tick?: string | null
        }
        Relationships: []
      }
      grupos_envios: {
        Row: {
          chat_id: string
          enviado_em: string | null
          erro: string | null
          grupo_id: string
          id: string
          mensagem_id: string
          message_id: string | null
          ordem: number
          proximo_em: string
          status: string
          tentativas: number
          updated_at: string
        }
        Insert: {
          chat_id: string
          enviado_em?: string | null
          erro?: string | null
          grupo_id: string
          id?: string
          mensagem_id: string
          message_id?: string | null
          ordem?: number
          proximo_em: string
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Update: {
          chat_id?: string
          enviado_em?: string | null
          erro?: string | null
          grupo_id?: string
          id?: string
          mensagem_id?: string
          message_id?: string | null
          ordem?: number
          proximo_em?: string
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_envios_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanha_grupos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_envios_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "grupos_mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_membros_eventos: {
        Row: {
          boas_vindas_pendente: boolean
          campanha_id: string
          chave: string
          created_at: string
          grupo_id: string
          id: number
          participantes: string[]
          quantidade: number
          tipo: string
        }
        Insert: {
          boas_vindas_pendente?: boolean
          campanha_id: string
          chave: string
          created_at?: string
          grupo_id: string
          id?: never
          participantes?: string[]
          quantidade: number
          tipo: string
        }
        Update: {
          boas_vindas_pendente?: boolean
          campanha_id?: string
          chave?: string
          created_at?: string
          grupo_id?: string
          id?: never
          participantes?: string[]
          quantidade?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_membros_eventos_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grupos_membros_eventos_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanha_grupos"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_mensagens: {
        Row: {
          agendado_para: string
          campanha_id: string
          concluido_em: string | null
          created_at: string
          criado_por: string | null
          disparo_id: string | null
          enquete_multipla: boolean
          enquete_opcoes: string[] | null
          enviados: number
          falhas: number
          grupos_alvo: string[] | null
          id: string
          iniciado_em: string | null
          link_preview: boolean
          mencionar_todos: boolean
          midia_path: string | null
          motivo: string | null
          nome_arquivo: string | null
          offset_min: number | null
          ptt: boolean
          relativo_evento: boolean
          status: string
          texto: string | null
          tipo: string
          total_grupos: number
          updated_at: string
        }
        Insert: {
          agendado_para: string
          campanha_id: string
          concluido_em?: string | null
          created_at?: string
          criado_por?: string | null
          disparo_id?: string | null
          enquete_multipla?: boolean
          enquete_opcoes?: string[] | null
          enviados?: number
          falhas?: number
          grupos_alvo?: string[] | null
          id?: string
          iniciado_em?: string | null
          link_preview?: boolean
          mencionar_todos?: boolean
          midia_path?: string | null
          motivo?: string | null
          nome_arquivo?: string | null
          offset_min?: number | null
          ptt?: boolean
          relativo_evento?: boolean
          status?: string
          texto?: string | null
          tipo: string
          total_grupos?: number
          updated_at?: string
        }
        Update: {
          agendado_para?: string
          campanha_id?: string
          concluido_em?: string | null
          created_at?: string
          criado_por?: string | null
          disparo_id?: string | null
          enquete_multipla?: boolean
          enquete_opcoes?: string[] | null
          enviados?: number
          falhas?: number
          grupos_alvo?: string[] | null
          id?: string
          iniciado_em?: string | null
          link_preview?: boolean
          mencionar_todos?: boolean
          midia_path?: string | null
          motivo?: string | null
          nome_arquivo?: string | null
          offset_min?: number | null
          ptt?: boolean
          relativo_evento?: boolean
          status?: string
          texto?: string | null
          tipo?: string
          total_grupos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grupos_mensagens_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "grupos_campanhas"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_contas: {
        Row: {
          atualizado_em: string
          conectado_em: string
          conectado_por: string | null
          foto_url: string | null
          id: string
          ig_app_user_id: string | null
          ig_user_id: string
          nome: string
          permissoes: string[]
          status: string
          token_cifrado: string | null
          token_expira_em: string | null
          ultimo_erro: string | null
          username: string
          webhook_assinado: boolean
        }
        Insert: {
          atualizado_em?: string
          conectado_em?: string
          conectado_por?: string | null
          foto_url?: string | null
          id?: string
          ig_app_user_id?: string | null
          ig_user_id: string
          nome?: string
          permissoes?: string[]
          status?: string
          token_cifrado?: string | null
          token_expira_em?: string | null
          ultimo_erro?: string | null
          username?: string
          webhook_assinado?: boolean
        }
        Update: {
          atualizado_em?: string
          conectado_em?: string
          conectado_por?: string | null
          foto_url?: string | null
          id?: string
          ig_app_user_id?: string | null
          ig_user_id?: string
          nome?: string
          permissoes?: string[]
          status?: string
          token_cifrado?: string | null
          token_expira_em?: string | null
          ultimo_erro?: string | null
          username?: string
          webhook_assinado?: boolean
        }
        Relationships: []
      }
      ig_contatos: {
        Row: {
          ai_agent_slug: string | null
          ai_pausado: boolean
          avatar_atualizado_em: string | null
          avatar_url: string | null
          conta_id: string
          created_at: string
          id: string
          igsid: string
          name: string
          notes: string | null
          phone: string
          segue_voce: boolean | null
          seguidores: number | null
          stage: string
          tags: string[]
          ultima_entrada_em: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          ai_agent_slug?: string | null
          ai_pausado?: boolean
          avatar_atualizado_em?: string | null
          avatar_url?: string | null
          conta_id: string
          created_at?: string
          id?: string
          igsid: string
          name?: string
          notes?: string | null
          phone: string
          segue_voce?: boolean | null
          seguidores?: number | null
          stage?: string
          tags?: string[]
          ultima_entrada_em?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          ai_agent_slug?: string | null
          ai_pausado?: boolean
          avatar_atualizado_em?: string | null
          avatar_url?: string | null
          conta_id?: string
          created_at?: string
          id?: string
          igsid?: string
          name?: string
          notes?: string | null
          phone?: string
          segue_voce?: boolean | null
          seguidores?: number | null
          stage?: string
          tags?: string[]
          ultima_entrada_em?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ig_contatos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "ig_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_contatos_stage_fkey"
            columns: ["stage"]
            isOneToOne: false
            referencedRelation: "crm_etapas"
            referencedColumns: ["slug"]
          },
        ]
      }
      ig_mensagens: {
        Row: {
          body: string
          caption: string | null
          conta_id: string
          contact_phone: string
          contato_id: string | null
          created_at: string
          direction: string
          enviado_por: string | null
          erro: string | null
          file_name: string | null
          id: string
          media_type: string | null
          media_url: string | null
          message_id: string | null
          mime_type: string | null
          sender_type: string
          status: string | null
          tag: string | null
        }
        Insert: {
          body?: string
          caption?: string | null
          conta_id: string
          contact_phone: string
          contato_id?: string | null
          created_at?: string
          direction?: string
          enviado_por?: string | null
          erro?: string | null
          file_name?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          sender_type?: string
          status?: string | null
          tag?: string | null
        }
        Update: {
          body?: string
          caption?: string | null
          conta_id?: string
          contact_phone?: string
          contato_id?: string | null
          created_at?: string
          direction?: string
          enviado_por?: string | null
          erro?: string | null
          file_name?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          sender_type?: string
          status?: string | null
          tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ig_mensagens_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "ig_contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ig_mensagens_contato_id_fkey"
            columns: ["contato_id"]
            isOneToOne: false
            referencedRelation: "ig_contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      ig_oauth_estados: {
        Row: {
          criado_em: string
          state: string
          user_id: string
        }
        Insert: {
          criado_em?: string
          state: string
          user_id: string
        }
        Update: {
          criado_em?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      ig_pareamento_nonces: {
        Row: {
          criado_em: string
          nonce: string
        }
        Insert: {
          criado_em?: string
          nonce: string
        }
        Update: {
          criado_em?: string
          nonce?: string
        }
        Relationships: []
      }
      influencers_parceria: {
        Row: {
          created_at: string
          email: string | null
          feed_post_date: string | null
          id: string
          instagram: string | null
          name: string
          notes: string | null
          phone: string | null
          sales_count: number
          status: string
          stories_active: boolean | null
          stories_rating: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          feed_post_date?: string | null
          id?: string
          instagram?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          sales_count?: number
          status?: string
          stories_active?: boolean | null
          stories_rating?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          feed_post_date?: string | null
          id?: string
          instagram?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          sales_count?: number
          status?: string
          stories_active?: boolean | null
          stories_rating?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      integracao_config: {
        Row: {
          atualizado_em: string
          chave: string
          valor: string
        }
        Insert: {
          atualizado_em?: string
          chave: string
          valor: string
        }
        Update: {
          atualizado_em?: string
          chave?: string
          valor?: string
        }
        Relationships: []
      }
      lead_form_responses: {
        Row: {
          consultation_id: string | null
          created_at: string
          email: string | null
          host_breno: boolean | null
          id: string
          instagram: string | null
          nivel: string
          nome: string | null
          origem: string | null
          origem_host: string | null
          p1_objetivo: string | null
          p2_situacao: string | null
          p3_profissao: string | null
          p4_altura: number | null
          p4_idade: number | null
          p4_peso: number | null
          p5_estrategias: string | null
          p6_caneta: string | null
          p7_acompanhamento: string | null
          p8_investimento: string | null
          p9_prioridade: string | null
          renda_mensal: string | null
          score: number
          telefone: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          consultation_id?: string | null
          created_at?: string
          email?: string | null
          host_breno?: boolean | null
          id?: string
          instagram?: string | null
          nivel?: string
          nome?: string | null
          origem?: string | null
          origem_host?: string | null
          p1_objetivo?: string | null
          p2_situacao?: string | null
          p3_profissao?: string | null
          p4_altura?: number | null
          p4_idade?: number | null
          p4_peso?: number | null
          p5_estrategias?: string | null
          p6_caneta?: string | null
          p7_acompanhamento?: string | null
          p8_investimento?: string | null
          p9_prioridade?: string | null
          renda_mensal?: string | null
          score?: number
          telefone?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          consultation_id?: string | null
          created_at?: string
          email?: string | null
          host_breno?: boolean | null
          id?: string
          instagram?: string | null
          nivel?: string
          nome?: string | null
          origem?: string | null
          origem_host?: string | null
          p1_objetivo?: string | null
          p2_situacao?: string | null
          p3_profissao?: string | null
          p4_altura?: number | null
          p4_idade?: number | null
          p4_peso?: number | null
          p5_estrategias?: string | null
          p6_caneta?: string | null
          p7_acompanhamento?: string | null
          p8_investimento?: string | null
          p9_prioridade?: string | null
          renda_mensal?: string | null
          score?: number
          telefone?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      lead_recovery: {
        Row: {
          created_at: string
          form_response_id: string
          id: string
          nota: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          form_response_id: string
          id?: string
          nota?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          form_response_id?: string
          id?: string
          nota?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_recovery_form_response_id_fkey"
            columns: ["form_response_id"]
            isOneToOne: true
            referencedRelation: "lead_form_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_tracking: {
        Row: {
          click_id: string
          created_at: string
          email: string | null
          id: string
          page_url: string
          phone: string | null
          profile_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          click_id: string
          created_at?: string
          email?: string | null
          id?: string
          page_url?: string
          phone?: string | null
          profile_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          click_id?: string
          created_at?: string
          email?: string | null
          id?: string
          page_url?: string
          phone?: string | null
          profile_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      live_destinations: {
        Row: {
          ativo: boolean
          chave_cifrada: string | null
          chave_final: string
          created_at: string
          id: string
          modo: string
          no_ar: boolean
          nome: string
          room_id: string
          rtmp_url: string
          tipo: string
          updated_at: string
          yt_agendado_para: string | null
          yt_broadcast_id: string | null
          yt_conta_id: string | null
          yt_descricao: string | null
          yt_erro: string | null
          yt_estado: string | null
          yt_miniatura_ok: boolean
          yt_playlist_id: string | null
          yt_privacidade: string | null
          yt_stream_id: string | null
          yt_titulo: string | null
          yt_video_id: string | null
        }
        Insert: {
          ativo?: boolean
          chave_cifrada?: string | null
          chave_final?: string
          created_at?: string
          id?: string
          modo?: string
          no_ar?: boolean
          nome: string
          room_id: string
          rtmp_url: string
          tipo: string
          updated_at?: string
          yt_agendado_para?: string | null
          yt_broadcast_id?: string | null
          yt_conta_id?: string | null
          yt_descricao?: string | null
          yt_erro?: string | null
          yt_estado?: string | null
          yt_miniatura_ok?: boolean
          yt_playlist_id?: string | null
          yt_privacidade?: string | null
          yt_stream_id?: string | null
          yt_titulo?: string | null
          yt_video_id?: string | null
        }
        Update: {
          ativo?: boolean
          chave_cifrada?: string | null
          chave_final?: string
          created_at?: string
          id?: string
          modo?: string
          no_ar?: boolean
          nome?: string
          room_id?: string
          rtmp_url?: string
          tipo?: string
          updated_at?: string
          yt_agendado_para?: string | null
          yt_broadcast_id?: string | null
          yt_conta_id?: string | null
          yt_descricao?: string | null
          yt_erro?: string | null
          yt_estado?: string | null
          yt_miniatura_ok?: boolean
          yt_playlist_id?: string | null
          yt_privacidade?: string | null
          yt_stream_id?: string | null
          yt_titulo?: string | null
          yt_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_destinations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_destinations_yt_conta_id_fkey"
            columns: ["yt_conta_id"]
            isOneToOne: false
            referencedRelation: "yt_contas"
            referencedColumns: ["id"]
          },
        ]
      }
      live_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expira_em: string
          id: string
          nome_convidado: string
          revogado: boolean
          room_id: string
          token_hash: string
          usado_em: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expira_em: string
          id?: string
          nome_convidado: string
          revogado?: boolean
          room_id: string
          token_hash: string
          usado_em?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expira_em?: string
          id?: string
          nome_convidado?: string
          revogado?: boolean
          room_id?: string
          token_hash?: string
          usado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      live_overlays: {
        Row: {
          conteudo: Json
          created_at: string
          id: string
          ordem: number
          room_id: string
          tipo: string
          updated_at: string
          visivel: boolean
        }
        Insert: {
          conteudo?: Json
          created_at?: string
          id?: string
          ordem?: number
          room_id: string
          tipo: string
          updated_at?: string
          visivel?: boolean
        }
        Update: {
          conteudo?: Json
          created_at?: string
          id?: string
          ordem?: number
          room_id?: string
          tipo?: string
          updated_at?: string
          visivel?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "live_overlays_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      live_pareamento_nonces: {
        Row: {
          criado_em: string
          nonce: string
        }
        Insert: {
          criado_em?: string
          nonce: string
        }
        Update: {
          criado_em?: string
          nonce?: string
        }
        Relationships: []
      }
      live_reprise_series: {
        Row: {
          ativa: boolean
          atualizada_em: string
          config: Json
          criada_em: string
          frequencia_dias: number
          id: string
          janela: number
          owner_id: string | null
          proxima_em: string
          room_origem_id: string
          tentar_depois: string | null
          ultimo_erro: string | null
        }
        Insert: {
          ativa?: boolean
          atualizada_em?: string
          config?: Json
          criada_em?: string
          frequencia_dias: number
          id?: string
          janela?: number
          owner_id?: string | null
          proxima_em: string
          room_origem_id: string
          tentar_depois?: string | null
          ultimo_erro?: string | null
        }
        Update: {
          ativa?: boolean
          atualizada_em?: string
          config?: Json
          criada_em?: string
          frequencia_dias?: number
          id?: string
          janela?: number
          owner_id?: string | null
          proxima_em?: string
          room_origem_id?: string
          tentar_depois?: string | null
          ultimo_erro?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_reprise_series_room_origem_id_fkey"
            columns: ["room_origem_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      live_rooms: {
        Row: {
          agenda_aviso_em: string | null
          agenda_erro: string | null
          agenda_processada_em: string | null
          agendada_em: string | null
          aula_encerrar_ao_fim: boolean
          aula_identity: string | null
          aula_ingress_id: string | null
          aula_palco_auto: boolean
          aula_tocando_desde: string | null
          aula_tocando_video: string | null
          aula_video_id: string | null
          auto_iniciar: boolean
          cf_conectado: boolean
          cf_hls_url: string | null
          cf_live_input_uid: string | null
          cf_ultima_gravacao: string | null
          cor: string | null
          created_at: string
          descricao: string | null
          egress_id: string | null
          encerrada_em: string | null
          gravacao_egress_id: string | null
          id: string
          iniciada_em: string | null
          layout: string
          livekit_room: string | null
          owner_id: string
          reprise_cancelada_em: string | null
          reprise_de: string | null
          reprise_serie_id: string | null
          semana_id: string | null
          semana_ordem: number | null
          status: string
          titulo: string
          ultimo_erro: string | null
          updated_at: string
        }
        Insert: {
          agenda_aviso_em?: string | null
          agenda_erro?: string | null
          agenda_processada_em?: string | null
          agendada_em?: string | null
          aula_encerrar_ao_fim?: boolean
          aula_identity?: string | null
          aula_ingress_id?: string | null
          aula_palco_auto?: boolean
          aula_tocando_desde?: string | null
          aula_tocando_video?: string | null
          aula_video_id?: string | null
          auto_iniciar?: boolean
          cf_conectado?: boolean
          cf_hls_url?: string | null
          cf_live_input_uid?: string | null
          cf_ultima_gravacao?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          egress_id?: string | null
          encerrada_em?: string | null
          gravacao_egress_id?: string | null
          id?: string
          iniciada_em?: string | null
          layout?: string
          livekit_room?: string | null
          owner_id?: string
          reprise_cancelada_em?: string | null
          reprise_de?: string | null
          reprise_serie_id?: string | null
          semana_id?: string | null
          semana_ordem?: number | null
          status?: string
          titulo: string
          ultimo_erro?: string | null
          updated_at?: string
        }
        Update: {
          agenda_aviso_em?: string | null
          agenda_erro?: string | null
          agenda_processada_em?: string | null
          agendada_em?: string | null
          aula_encerrar_ao_fim?: boolean
          aula_identity?: string | null
          aula_ingress_id?: string | null
          aula_palco_auto?: boolean
          aula_tocando_desde?: string | null
          aula_tocando_video?: string | null
          aula_video_id?: string | null
          auto_iniciar?: boolean
          cf_conectado?: boolean
          cf_hls_url?: string | null
          cf_live_input_uid?: string | null
          cf_ultima_gravacao?: string | null
          cor?: string | null
          created_at?: string
          descricao?: string | null
          egress_id?: string | null
          encerrada_em?: string | null
          gravacao_egress_id?: string | null
          id?: string
          iniciada_em?: string | null
          layout?: string
          livekit_room?: string | null
          owner_id?: string
          reprise_cancelada_em?: string | null
          reprise_de?: string | null
          reprise_serie_id?: string | null
          semana_id?: string | null
          semana_ordem?: number | null
          status?: string
          titulo?: string
          ultimo_erro?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_rooms_aula_video_id_fkey"
            columns: ["aula_video_id"]
            isOneToOne: false
            referencedRelation: "live_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_rooms_reprise_de_fkey"
            columns: ["reprise_de"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_rooms_reprise_serie_id_fkey"
            columns: ["reprise_serie_id"]
            isOneToOne: false
            referencedRelation: "live_reprise_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_rooms_semana_id_fkey"
            columns: ["semana_id"]
            isOneToOne: false
            referencedRelation: "live_semanas"
            referencedColumns: ["id"]
          },
        ]
      }
      live_semanas: {
        Row: {
          cancelada_em: string | null
          criada_em: string
          id: string
          nome: string
          owner_id: string | null
          playlist_criada: boolean
          playlist_id: string | null
          privacidade: string
          room_origem_id: string
          yt_conta_id: string | null
        }
        Insert: {
          cancelada_em?: string | null
          criada_em?: string
          id?: string
          nome: string
          owner_id?: string | null
          playlist_criada?: boolean
          playlist_id?: string | null
          privacidade?: string
          room_origem_id: string
          yt_conta_id?: string | null
        }
        Update: {
          cancelada_em?: string | null
          criada_em?: string
          id?: string
          nome?: string
          owner_id?: string | null
          playlist_criada?: boolean
          playlist_id?: string | null
          privacidade?: string
          room_origem_id?: string
          yt_conta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_semanas_room_origem_id_fkey"
            columns: ["room_origem_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      live_videos: {
        Row: {
          altura: number | null
          bytes: number | null
          created_at: string
          duracao_seg: number | null
          erro: string | null
          id: string
          largura: number | null
          nome: string
          owner_id: string | null
          room_id: string | null
          status: string
          tem_audio: boolean | null
          updated_at: string
        }
        Insert: {
          altura?: number | null
          bytes?: number | null
          created_at?: string
          duracao_seg?: number | null
          erro?: string | null
          id?: string
          largura?: number | null
          nome: string
          owner_id?: string | null
          room_id?: string | null
          status?: string
          tem_audio?: boolean | null
          updated_at?: string
        }
        Update: {
          altura?: number | null
          bytes?: number | null
          created_at?: string
          duracao_seg?: number | null
          erro?: string | null
          id?: string
          largura?: number | null
          nome?: string
          owner_id?: string | null
          room_id?: string | null
          status?: string
          tem_audio?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_videos_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_data: {
        Row: {
          campanha_meta: number
          colaboradores: number
          comissao: number
          created_at: string
          faturamento: number
          ferramentas: number
          id: string
          imposto_percent: number
          month: string
          trafego: number
          updated_at: string
          whatsapp_cost: number
          whatsapp_messages_received: number
          whatsapp_messages_sent: number
        }
        Insert: {
          campanha_meta?: number
          colaboradores?: number
          comissao?: number
          created_at?: string
          faturamento?: number
          ferramentas?: number
          id?: string
          imposto_percent?: number
          month: string
          trafego?: number
          updated_at?: string
          whatsapp_cost?: number
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
        }
        Update: {
          campanha_meta?: number
          colaboradores?: number
          comissao?: number
          created_at?: string
          faturamento?: number
          ferramentas?: number
          id?: string
          imposto_percent?: number
          month?: string
          trafego?: number
          updated_at?: string
          whatsapp_cost?: number
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
        }
        Relationships: []
      }
      page_beacons: {
        Row: {
          cm_click: string | null
          created_at: string
          id: number
          kind: string
          lcp_ms: number | null
          nav: string | null
          page: string
          render_ms: number | null
          ttfb_ms: number | null
          variant: string
        }
        Insert: {
          cm_click?: string | null
          created_at?: string
          id?: number
          kind: string
          lcp_ms?: number | null
          nav?: string | null
          page: string
          render_ms?: number | null
          ttfb_ms?: number | null
          variant: string
        }
        Update: {
          cm_click?: string | null
          created_at?: string
          id?: number
          kind?: string
          lcp_ms?: number | null
          nav?: string | null
          page?: string
          render_ms?: number | null
          ttfb_ms?: number | null
          variant?: string
        }
        Relationships: []
      }
      page_views: {
        Row: {
          created_at: string
          fbclid: string | null
          id: string
          profile_id: string
          referrer: string | null
          session_id: string
          url: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          fbclid?: string | null
          id?: string
          profile_id: string
          referrer?: string | null
          session_id: string
          url: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          fbclid?: string | null
          id?: string
          profile_id?: string
          referrer?: string | null
          session_id?: string
          url?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      pagtrust_webhook_bruto: {
        Row: {
          aprovada: boolean | null
          click_id: string | null
          id: number
          payload: Json
          pedido: string | null
          recebido_em: string
          reembolso: boolean | null
          resultado: string | null
          status: string | null
          valor: number | null
          variante: string | null
        }
        Insert: {
          aprovada?: boolean | null
          click_id?: string | null
          id?: never
          payload: Json
          pedido?: string | null
          recebido_em?: string
          reembolso?: boolean | null
          resultado?: string | null
          status?: string | null
          valor?: number | null
          variante?: string | null
        }
        Update: {
          aprovada?: boolean | null
          click_id?: string | null
          id?: never
          payload?: Json
          pedido?: string | null
          recebido_em?: string
          reembolso?: boolean | null
          resultado?: string | null
          status?: string | null
          valor?: number | null
          variante?: string | null
        }
        Relationships: []
      }
      pesquisa_responses: {
        Row: {
          comercial_clareza: string | null
          comercial_melhorar: string | null
          comercial_nota: number | null
          comercial_pressao: string | null
          created_at: string
          decepcionou: string | null
          expectativa_resultado: number | null
          id: string
          impede_resultado: string | null
          insta_cortar: string | null
          insta_frequencia: string | null
          insta_tipos: string[] | null
          insta_utilidade: number | null
          insta_ver_mais: string | null
          livre: string | null
          mudaria_uma_coisa: string | null
          nome: string
          nps_depoimento: string | null
          nps_indicou: string | null
          nps_motivo: string | null
          nps_nota: number | null
          nps_quem_fechou: string | null
          plano: string | null
          produto: string | null
          programa_indicacao_interesse: string | null
          programa_indicacao_nomes: string | null
          programa_indicacao_quer_contato: boolean | null
          satisfacao_geral: number | null
          surpreendeu: string | null
          tempo_programa: string | null
          wpp_clareza: number | null
          wpp_frequencia: string | null
          wpp_melhorar: string | null
          wpp_ouvida: string | null
          wpp_satisfacao: number | null
          wpp_tempo_resposta: number | null
        }
        Insert: {
          comercial_clareza?: string | null
          comercial_melhorar?: string | null
          comercial_nota?: number | null
          comercial_pressao?: string | null
          created_at?: string
          decepcionou?: string | null
          expectativa_resultado?: number | null
          id?: string
          impede_resultado?: string | null
          insta_cortar?: string | null
          insta_frequencia?: string | null
          insta_tipos?: string[] | null
          insta_utilidade?: number | null
          insta_ver_mais?: string | null
          livre?: string | null
          mudaria_uma_coisa?: string | null
          nome: string
          nps_depoimento?: string | null
          nps_indicou?: string | null
          nps_motivo?: string | null
          nps_nota?: number | null
          nps_quem_fechou?: string | null
          plano?: string | null
          produto?: string | null
          programa_indicacao_interesse?: string | null
          programa_indicacao_nomes?: string | null
          programa_indicacao_quer_contato?: boolean | null
          satisfacao_geral?: number | null
          surpreendeu?: string | null
          tempo_programa?: string | null
          wpp_clareza?: number | null
          wpp_frequencia?: string | null
          wpp_melhorar?: string | null
          wpp_ouvida?: string | null
          wpp_satisfacao?: number | null
          wpp_tempo_resposta?: number | null
        }
        Update: {
          comercial_clareza?: string | null
          comercial_melhorar?: string | null
          comercial_nota?: number | null
          comercial_pressao?: string | null
          created_at?: string
          decepcionou?: string | null
          expectativa_resultado?: number | null
          id?: string
          impede_resultado?: string | null
          insta_cortar?: string | null
          insta_frequencia?: string | null
          insta_tipos?: string[] | null
          insta_utilidade?: number | null
          insta_ver_mais?: string | null
          livre?: string | null
          mudaria_uma_coisa?: string | null
          nome?: string
          nps_depoimento?: string | null
          nps_indicou?: string | null
          nps_motivo?: string | null
          nps_nota?: number | null
          nps_quem_fechou?: string | null
          plano?: string | null
          produto?: string | null
          programa_indicacao_interesse?: string | null
          programa_indicacao_nomes?: string | null
          programa_indicacao_quer_contato?: boolean | null
          satisfacao_geral?: number | null
          surpreendeu?: string | null
          tempo_programa?: string | null
          wpp_clareza?: number | null
          wpp_frequencia?: string | null
          wpp_melhorar?: string | null
          wpp_ouvida?: string | null
          wpp_satisfacao?: number | null
          wpp_tempo_resposta?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved: boolean
          availability_overrides: Json | null
          availability_weekly: Json | null
          available_slots_json: Json | null
          avatar_url: string | null
          concurrent_capacity: number
          created_at: string
          full_name: string
          id: string
          is_closer: boolean
          max_daily_bookings: number | null
          slot_gap_minutes: number | null
          tracking_token: string | null
          updated_at: string
        }
        Insert: {
          approved?: boolean
          availability_overrides?: Json | null
          availability_weekly?: Json | null
          available_slots_json?: Json | null
          avatar_url?: string | null
          concurrent_capacity?: number
          created_at?: string
          full_name?: string
          id: string
          is_closer?: boolean
          max_daily_bookings?: number | null
          slot_gap_minutes?: number | null
          tracking_token?: string | null
          updated_at?: string
        }
        Update: {
          approved?: boolean
          availability_overrides?: Json | null
          availability_weekly?: Json | null
          available_slots_json?: Json | null
          avatar_url?: string | null
          concurrent_capacity?: number
          created_at?: string
          full_name?: string
          id?: string
          is_closer?: boolean
          max_daily_bookings?: number | null
          slot_gap_minutes?: number | null
          tracking_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles_meta_credenciais: {
        Row: {
          meta_access_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          meta_access_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          meta_access_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_meta_credenciais_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_clicks: {
        Row: {
          click_id: string
          created_at: string
          destination_id: string
          id: string
          ip_address: string | null
          referer: string | null
          rotator_id: string
          user_agent: string | null
        }
        Insert: {
          click_id: string
          created_at?: string
          destination_id: string
          id?: string
          ip_address?: string | null
          referer?: string | null
          rotator_id: string
          user_agent?: string | null
        }
        Update: {
          click_id?: string
          created_at?: string
          destination_id?: string
          id?: string
          ip_address?: string | null
          referer?: string | null
          rotator_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rotator_clicks_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "rotator_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotator_clicks_rotator_id_fkey"
            columns: ["rotator_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_destinations: {
        Row: {
          created_at: string
          id: string
          label: string
          otim_peso: number | null
          otim_prob_melhor: number | null
          otim_status: string | null
          peso_manual: number | null
          rotator_id: string
          url: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          otim_peso?: number | null
          otim_prob_melhor?: number | null
          otim_status?: string | null
          peso_manual?: number | null
          rotator_id: string
          url: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          otim_peso?: number | null
          otim_prob_melhor?: number | null
          otim_status?: string | null
          peso_manual?: number | null
          rotator_id?: string
          url?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "rotator_destinations_rotator_id_fkey"
            columns: ["rotator_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_events: {
        Row: {
          click_id: string
          created_at: string
          event_type: string
          id: string
          order_id: string | null
          page_url: string | null
          value: number | null
        }
        Insert: {
          click_id: string
          created_at?: string
          event_type: string
          id?: string
          order_id?: string | null
          page_url?: string | null
          value?: number | null
        }
        Update: {
          click_id?: string
          created_at?: string
          event_type?: string
          id?: string
          order_id?: string | null
          page_url?: string | null
          value?: number | null
        }
        Relationships: []
      }
      rotator_links: {
        Row: {
          conversion_rule: Json | null
          created_at: string
          id: string
          meta_config: Json | null
          name: string
          otim_ativa: boolean
          otim_fase: string | null
          otim_min_compras: number
          otim_min_visitas: number
          otim_piso: number
          otim_recalc_visitas: number
          otim_recalculado_em: string | null
          otim_teto: number
          otim_visitas_no_calculo: number
          slug: string
        }
        Insert: {
          conversion_rule?: Json | null
          created_at?: string
          id?: string
          meta_config?: Json | null
          name: string
          otim_ativa?: boolean
          otim_fase?: string | null
          otim_min_compras?: number
          otim_min_visitas?: number
          otim_piso?: number
          otim_recalc_visitas?: number
          otim_recalculado_em?: string | null
          otim_teto?: number
          otim_visitas_no_calculo?: number
          slug: string
        }
        Update: {
          conversion_rule?: Json | null
          created_at?: string
          id?: string
          meta_config?: Json | null
          name?: string
          otim_ativa?: boolean
          otim_fase?: string | null
          otim_min_compras?: number
          otim_min_visitas?: number
          otim_piso?: number
          otim_recalc_visitas?: number
          otim_recalculado_em?: string | null
          otim_teto?: number
          otim_visitas_no_calculo?: number
          slug?: string
        }
        Relationships: []
      }
      rotator_vendas_sem_versao: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_id: string
          rotator_link_id: string
          sold_at: string
          source: string
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id: string
          rotator_link_id: string
          sold_at?: string
          source?: string
          value: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string
          rotator_link_id?: string
          sold_at?: string
          source?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "rotator_vendas_sem_versao_rotator_link_id_fkey"
            columns: ["rotator_link_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_webhook_segredo: {
        Row: {
          criado_em: string
          id: number
          nome_funcao: string
        }
        Insert: {
          criado_em?: string
          id?: number
          nome_funcao: string
        }
        Update: {
          criado_em?: string
          id?: number
          nome_funcao?: string
        }
        Relationships: []
      }
      sales_events: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_phone: string | null
          id: string
          lead_id: string | null
          profile_id: string
          source: string
          value: number
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          id?: string
          lead_id?: string | null
          profile_id: string
          source?: string
          value?: number
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_phone?: string | null
          id?: string
          lead_id?: string | null
          profile_id?: string
          source?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_tracking"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          page_url: string
          profile_id: string
          session_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          page_url: string
          profile_id: string
          session_id: string
          value?: number | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          page_url?: string
          profile_id?: string
          session_id?: string
          value?: number | null
        }
        Relationships: []
      }
      user_modules: {
        Row: {
          created_at: string
          id: string
          module: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: string
          user_id?: string
        }
        Relationships: []
      }
      user_modules_legado_comercial: {
        Row: {
          guardado_em: string
          module: string
          user_id: string
        }
        Insert: {
          guardado_em?: string
          module: string
          user_id: string
        }
        Update: {
          guardado_em?: string
          module?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webinar_analytics: {
        Row: {
          clicked_cta: boolean
          created_at: string
          entered_at: string
          id: string
          session_id: string
          updated_at: string
          url_version: string
          user_agent: string | null
          video_watched_seconds: number
        }
        Insert: {
          clicked_cta?: boolean
          created_at?: string
          entered_at?: string
          id?: string
          session_id: string
          updated_at?: string
          url_version: string
          user_agent?: string | null
          video_watched_seconds?: number
        }
        Update: {
          clicked_cta?: boolean
          created_at?: string
          entered_at?: string
          id?: string
          session_id?: string
          updated_at?: string
          url_version?: string
          user_agent?: string | null
          video_watched_seconds?: number
        }
        Relationships: []
      }
      webinar_attendance: {
        Row: {
          clicou_oferta: boolean
          entrou_em: string
          id: string
          registration_id: string
          segundos_assistidos: number
          session_id: string
          ultimo_ping: string
        }
        Insert: {
          clicou_oferta?: boolean
          entrou_em?: string
          id?: string
          registration_id: string
          segundos_assistidos?: number
          session_id: string
          ultimo_ping?: string
        }
        Update: {
          clicou_oferta?: boolean
          entrou_em?: string
          id?: string
          registration_id?: string
          segundos_assistidos?: number
          session_id?: string
          ultimo_ping?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_attendance_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "webinar_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "webinar_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_chat_messages: {
        Row: {
          autor_nome: string
          created_at: string
          fixada: boolean
          id: number
          oculta: boolean
          papel: string
          registration_id: string | null
          session_id: string
          texto: string
        }
        Insert: {
          autor_nome: string
          created_at?: string
          fixada?: boolean
          id?: number
          oculta?: boolean
          papel?: string
          registration_id?: string | null
          session_id: string
          texto: string
        }
        Update: {
          autor_nome?: string
          created_at?: string
          fixada?: boolean
          id?: number
          oculta?: boolean
          papel?: string
          registration_id?: string | null
          session_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_chat_messages_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "webinar_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "webinar_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_chat_script: {
        Row: {
          aos_seg: number
          autor_nome: string
          created_at: string
          id: string
          texto: string
          webinar_id: string
        }
        Insert: {
          aos_seg: number
          autor_nome: string
          created_at?: string
          id?: string
          texto: string
          webinar_id: string
        }
        Update: {
          aos_seg?: number
          autor_nome?: string
          created_at?: string
          id?: string
          texto?: string
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_chat_script_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_offers: {
        Row: {
          aparece_em_seg: number | null
          ativo: boolean
          checkout_link_id: string | null
          created_at: string
          cta_texto: string
          descricao: string | null
          dura_seg: number | null
          encerrada_em: string | null
          id: string
          liberada_em: string | null
          liberada_session_id: string | null
          modo: string
          ordem: number
          preco_texto: string | null
          titulo: string
          url: string | null
          webinar_id: string
        }
        Insert: {
          aparece_em_seg?: number | null
          ativo?: boolean
          checkout_link_id?: string | null
          created_at?: string
          cta_texto?: string
          descricao?: string | null
          dura_seg?: number | null
          encerrada_em?: string | null
          id?: string
          liberada_em?: string | null
          liberada_session_id?: string | null
          modo?: string
          ordem?: number
          preco_texto?: string | null
          titulo: string
          url?: string | null
          webinar_id: string
        }
        Update: {
          aparece_em_seg?: number | null
          ativo?: boolean
          checkout_link_id?: string | null
          created_at?: string
          cta_texto?: string
          descricao?: string | null
          dura_seg?: number | null
          encerrada_em?: string | null
          id?: string
          liberada_em?: string | null
          liberada_session_id?: string | null
          modo?: string
          ordem?: number
          preco_texto?: string | null
          titulo?: string
          url?: string | null
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_offers_liberada_session_id_fkey"
            columns: ["liberada_session_id"]
            isOneToOne: false
            referencedRelation: "webinar_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_offers_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_registrations: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          nome: string
          session_id: string
          ultimo_acesso: string | null
          utm: Json
          webinar_id: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          nome: string
          session_id: string
          ultimo_acesso?: string | null
          utm?: Json
          webinar_id: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          nome?: string
          session_id?: string
          ultimo_acesso?: string | null
          utm?: Json
          webinar_id?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webinar_registrations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "webinar_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_registrations_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_reminders_queue: {
        Row: {
          created_at: string
          enviado_em: string | null
          enviar_em: string
          erro: string | null
          id: string
          registration_id: string
          session_id: string
          status: string
          tentativas: number
          tipo: string
        }
        Insert: {
          created_at?: string
          enviado_em?: string | null
          enviar_em: string
          erro?: string | null
          id?: string
          registration_id: string
          session_id: string
          status?: string
          tentativas?: number
          tipo: string
        }
        Update: {
          created_at?: string
          enviado_em?: string | null
          enviar_em?: string
          erro?: string | null
          id?: string
          registration_id?: string
          session_id?: string
          status?: string
          tentativas?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_reminders_queue_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "webinar_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_reminders_queue_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "webinar_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_sessions: {
        Row: {
          created_at: string
          encerrada_em: string | null
          hls_url: string | null
          id: string
          inicia_em: string
          iniciada_em: string | null
          status: string
          webinar_id: string
        }
        Insert: {
          created_at?: string
          encerrada_em?: string | null
          hls_url?: string | null
          id?: string
          inicia_em: string
          iniciada_em?: string | null
          status?: string
          webinar_id: string
        }
        Update: {
          created_at?: string
          encerrada_em?: string | null
          hls_url?: string | null
          id?: string
          inicia_em?: string
          iniciada_em?: string | null
          status?: string
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_sessions_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinars: {
        Row: {
          capa_url: string | null
          chat_ativo: boolean
          created_at: string
          descricao: string | null
          hls_offset_seg: number
          id: string
          lembretes: Json
          lembretes_ativos: boolean
          live_room_id: string | null
          mostrar_presentes: boolean
          owner_id: string
          slug: string
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          capa_url?: string | null
          chat_ativo?: boolean
          created_at?: string
          descricao?: string | null
          hls_offset_seg?: number
          id?: string
          lembretes?: Json
          lembretes_ativos?: boolean
          live_room_id?: string | null
          mostrar_presentes?: boolean
          owner_id?: string
          slug: string
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          capa_url?: string | null
          chat_ativo?: boolean
          created_at?: string
          descricao?: string | null
          hls_offset_seg?: number
          id?: string
          lembretes?: Json
          lembretes_ativos?: boolean
          live_room_id?: string | null
          mostrar_presentes?: boolean
          owner_id?: string
          slug?: string
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinars_live_room_id_fkey"
            columns: ["live_room_id"]
            isOneToOne: false
            referencedRelation: "live_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_backfill_chats: {
        Row: {
          chat_id: string
          erro: string | null
          feito_em: string | null
          id: number
          job_id: string
          kind: string
          mensagens: number
          nome: string | null
          phone: string | null
          status: string
          tentativas: number
          ts: number | null
        }
        Insert: {
          chat_id: string
          erro?: string | null
          feito_em?: string | null
          id?: number
          job_id: string
          kind: string
          mensagens?: number
          nome?: string | null
          phone?: string | null
          status?: string
          tentativas?: number
          ts?: number | null
        }
        Update: {
          chat_id?: string
          erro?: string | null
          feito_em?: string | null
          id?: number
          job_id?: string
          kind?: string
          mensagens?: number
          nome?: string | null
          phone?: string | null
          status?: string
          tentativas?: number
          ts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_backfill_chats_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_backfill_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_backfill_jobs: {
        Row: {
          atualizado_em: string
          aviso: string | null
          chats_erro: number
          chats_feitos: number
          completo: boolean
          concluido_em: string | null
          criado_em: string
          criado_por: string | null
          erro: string | null
          grupos: boolean
          id: string
          midias: number
          midias_por_chat: number
          msgs_importadas: number
          numero_id: string
          offset_lista: number
          por_chat: number
          status: string
          total_chats: number
          ultimo_tick: string | null
        }
        Insert: {
          atualizado_em?: string
          aviso?: string | null
          chats_erro?: number
          chats_feitos?: number
          completo?: boolean
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          erro?: string | null
          grupos?: boolean
          id?: string
          midias?: number
          midias_por_chat?: number
          msgs_importadas?: number
          numero_id?: string
          offset_lista?: number
          por_chat?: number
          status?: string
          total_chats?: number
          ultimo_tick?: string | null
        }
        Update: {
          atualizado_em?: string
          aviso?: string | null
          chats_erro?: number
          chats_feitos?: number
          completo?: boolean
          concluido_em?: string | null
          criado_em?: string
          criado_por?: string | null
          erro?: string | null
          grupos?: boolean
          id?: string
          midias?: number
          midias_por_chat?: number
          msgs_importadas?: number
          numero_id?: string
          offset_lista?: number
          por_chat?: number
          status?: string
          total_chats?: number
          ultimo_tick?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_backfill_jobs_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          ai_agent_slug: string | null
          ai_atribuido_em: string | null
          ai_falhas: number
          ai_pausado: boolean
          ai_pausado_motivo: string | null
          ai_precisa_humano: boolean
          ai_ref: string | null
          ai_respostas: number
          ai_transferido_em: string | null
          atendente: string | null
          atendente_em: string | null
          atendente_id: string | null
          avatar_atualizado_em: string | null
          avatar_url: string | null
          created_at: string
          departamento_id: string | null
          id: string
          is_group: boolean
          lista_mudou_em: string
          name: string
          notes: string | null
          numero_id: string
          phone: string
          source: string | null
          stage: string
          tags: string[]
          ultima_msg_em: string | null
          ultima_recebida_em: string | null
          updated_at: string
        }
        Insert: {
          ai_agent_slug?: string | null
          ai_atribuido_em?: string | null
          ai_falhas?: number
          ai_pausado?: boolean
          ai_pausado_motivo?: string | null
          ai_precisa_humano?: boolean
          ai_ref?: string | null
          ai_respostas?: number
          ai_transferido_em?: string | null
          atendente?: string | null
          atendente_em?: string | null
          atendente_id?: string | null
          avatar_atualizado_em?: string | null
          avatar_url?: string | null
          created_at?: string
          departamento_id?: string | null
          id?: string
          is_group?: boolean
          lista_mudou_em?: string
          name?: string
          notes?: string | null
          numero_id?: string
          phone: string
          source?: string | null
          stage?: string
          tags?: string[]
          ultima_msg_em?: string | null
          ultima_recebida_em?: string | null
          updated_at?: string
        }
        Update: {
          ai_agent_slug?: string | null
          ai_atribuido_em?: string | null
          ai_falhas?: number
          ai_pausado?: boolean
          ai_pausado_motivo?: string | null
          ai_precisa_humano?: boolean
          ai_ref?: string | null
          ai_respostas?: number
          ai_transferido_em?: string | null
          atendente?: string | null
          atendente_em?: string | null
          atendente_id?: string | null
          avatar_atualizado_em?: string | null
          avatar_url?: string | null
          created_at?: string
          departamento_id?: string | null
          id?: string
          is_group?: boolean
          lista_mudou_em?: string
          name?: string
          notes?: string | null
          numero_id?: string
          phone?: string
          source?: string | null
          stage?: string
          tags?: string[]
          ultima_msg_em?: string | null
          ultima_recebida_em?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "crm_departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_stage_fkey"
            columns: ["stage"]
            isOneToOne: false
            referencedRelation: "crm_etapas"
            referencedColumns: ["slug"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          author_id: string | null
          author_name: string | null
          author_phone: string | null
          body: string
          caption: string | null
          contact_phone: string
          created_at: string
          direction: string
          file_name: string | null
          id: string
          importada: boolean
          media_erro: string | null
          media_path: string | null
          media_status: string | null
          media_tentativas: number
          media_type: string | null
          media_url: string | null
          message_id: string | null
          mime_type: string | null
          numero_id: string
          sender_type: string
          status: string | null
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          author_phone?: string | null
          body?: string
          caption?: string | null
          contact_phone: string
          created_at?: string
          direction?: string
          file_name?: string | null
          id?: string
          importada?: boolean
          media_erro?: string | null
          media_path?: string | null
          media_status?: string | null
          media_tentativas?: number
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          numero_id?: string
          sender_type?: string
          status?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          author_phone?: string | null
          body?: string
          caption?: string | null
          contact_phone?: string
          created_at?: string
          direction?: string
          file_name?: string | null
          id?: string
          importada?: boolean
          media_erro?: string | null
          media_path?: string | null
          media_status?: string | null
          media_tentativas?: number
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          numero_id?: string
          sender_type?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_numero_id_fkey"
            columns: ["numero_id"]
            isOneToOne: false
            referencedRelation: "crm_numeros"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_wa_nomes: {
        Row: {
          atualizado_em: string
          nome: string | null
          telefone: string | null
          wid: string
        }
        Insert: {
          atualizado_em?: string
          nome?: string | null
          telefone?: string | null
          wid: string
        }
        Update: {
          atualizado_em?: string
          nome?: string | null
          telefone?: string | null
          wid?: string
        }
        Relationships: []
      }
      yt_contas: {
        Row: {
          atualizado_em: string
          canal_id: string
          conectado_por: string | null
          criado_em: string
          escopos: string[]
          foto_url: string | null
          id: string
          padrao: boolean
          refresh_token_cifrado: string | null
          status: string
          stream_id: string | null
          titulo: string
          ultimo_erro: string | null
        }
        Insert: {
          atualizado_em?: string
          canal_id: string
          conectado_por?: string | null
          criado_em?: string
          escopos?: string[]
          foto_url?: string | null
          id?: string
          padrao?: boolean
          refresh_token_cifrado?: string | null
          status?: string
          stream_id?: string | null
          titulo?: string
          ultimo_erro?: string | null
        }
        Update: {
          atualizado_em?: string
          canal_id?: string
          conectado_por?: string | null
          criado_em?: string
          escopos?: string[]
          foto_url?: string | null
          id?: string
          padrao?: boolean
          refresh_token_cifrado?: string | null
          status?: string
          stream_id?: string | null
          titulo?: string
          ultimo_erro?: string | null
        }
        Relationships: []
      }
      yt_oauth_estados: {
        Row: {
          criado_em: string
          state: string
          user_id: string
        }
        Insert: {
          criado_em?: string
          state: string
          user_id: string
        }
        Update: {
          criado_em?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      base_leads_unificada: {
        Row: {
          chave: string | null
          comprador: boolean | null
          email: string | null
          nivel: string | null
          nome: string | null
          origens: string[] | null
          primeira_entrada: string | null
          produto: string | null
          registros: number | null
          score: number | null
          tags: string[] | null
          telefone_e164: string | null
          ultima_entrada: string | null
        }
        Relationships: []
      }
      base_leads_unificada_mat: {
        Row: {
          chave: string | null
          comprador: boolean | null
          email: string | null
          nivel: string | null
          nome: string | null
          origens: string[] | null
          primeira_entrada: string | null
          produto: string | null
          registros: number | null
          score: number | null
          tags: string[] | null
          telefone_e164: string | null
          ultima_entrada: string | null
        }
        Relationships: []
      }
      rotator_events_por_destino: {
        Row: {
          click_id: string | null
          created_at: string | null
          destination_id: string | null
          event_id: string | null
          event_type: string | null
          order_id: string | null
          page_url: string | null
          rotator_id: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rotator_clicks_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "rotator_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotator_clicks_rotator_id_fkey"
            columns: ["rotator_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_page_beacons: {
        Row: {
          beacon_id: number | null
          cm_click: string | null
          created_at: string | null
          destination_id: string | null
          kind: string | null
          lcp_ms: number | null
          nav: string | null
          render_ms: number | null
          rotator_id: string | null
          ttfb_ms: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rotator_clicks_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "rotator_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotator_clicks_rotator_id_fkey"
            columns: ["rotator_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
      rotator_vendas_sem_versao_painel: {
        Row: {
          atribuida: boolean | null
          created_at: string | null
          id: string | null
          note: string | null
          order_id: string | null
          rotator_link_id: string | null
          sold_at: string | null
          source: string | null
          value: number | null
        }
        Insert: {
          atribuida?: never
          created_at?: string | null
          id?: string | null
          note?: string | null
          order_id?: string | null
          rotator_link_id?: string | null
          sold_at?: string | null
          source?: string | null
          value?: number | null
        }
        Update: {
          atribuida?: never
          created_at?: string | null
          id?: string | null
          note?: string | null
          order_id?: string | null
          rotator_link_id?: string | null
          sold_at?: string | null
          source?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rotator_vendas_sem_versao_rotator_link_id_fkey"
            columns: ["rotator_link_id"]
            isOneToOne: false
            referencedRelation: "rotator_links"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      aluna_do_usuario: { Args: { _user_id: string }; Returns: string }
      aluna_por_telefone_interno: {
        Args: { p_telefone: string }
        Returns: {
          id: string
          nome_completo: string
          programa: string
        }[]
      }
      anamnese_abrir: {
        Args: { p_token: string }
        Returns: {
          ja_respondida: boolean
          nome_aluna: string
          status: string
        }[]
      }
      anamnese_enviar: {
        Args: { p_dados: Json; p_token: string }
        Returns: boolean
      }
      anthropic_pareamento_aceita: { Args: never; Returns: boolean }
      anthropic_pareamento_gravar: {
        Args: { p_ip: string; p_nonce: string; p_valor: string }
        Returns: string
      }
      anthropic_pareamento_reabrir: { Args: never; Returns: string }
      apagar_aluna_teste: { Args: { _aluna: string }; Returns: Json }
      assign_next_closer: {
        Args: { p_date: string; p_time: string }
        Returns: string
      }
      aviso_responsavel: { Args: { _aluna: string }; Returns: string }
      base_leads_email: { Args: { bruto: string }; Returns: string }
      base_leads_form_de_cliente: {
        Args: { r: Database["public"]["Tables"]["lead_form_responses"]["Row"] }
        Returns: boolean
      }
      base_leads_produtos: {
        Args: never
        Returns: {
          linhas: number
          produto: string
        }[]
      }
      base_leads_resumo_origens: {
        Args: never
        Returns: {
          linhas: number
          origem: string
          ultima_entrada: string
          ultimo_importado: string
        }[]
      }
      base_leads_sincronizar: {
        Args: { p_desde?: string; p_sem_evento?: boolean }
        Returns: Json
      }
      base_leads_tel_e164: { Args: { bruto: string }; Returns: string }
      base_leads_unificada_atualizar: { Args: never; Returns: undefined }
      book_public_consultation:
        | {
            Args: {
              p_client_name: string
              p_client_phone: string
              p_date: string
              p_funnel?: string
              p_time: string
              p_utm_campaign?: string
              p_utm_content?: string
              p_utm_medium?: string
              p_utm_source?: string
              p_utm_term?: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_client_name: string
              p_client_phone: string
              p_date: string
              p_funnel?: string
              p_lead_score?: number
              p_time: string
              p_utm_campaign?: string
              p_utm_content?: string
              p_utm_medium?: string
              p_utm_source?: string
              p_utm_term?: string
            }
            Returns: boolean
          }
      book_public_consultation_v2: {
        Args: {
          p_client_name: string
          p_client_phone: string
          p_date: string
          p_funnel?: string
          p_lead_score?: number
          p_time: string
          p_utm_campaign?: string
          p_utm_content?: string
          p_utm_medium?: string
          p_utm_source?: string
          p_utm_term?: string
        }
        Returns: string
      }
      conteudo_meu_acesso: { Args: never; Returns: Json }
      conteudo_pode: { Args: { _uid: string }; Returns: boolean }
      conteudo_pub_criar: { Args: { p: Json }; Returns: string }
      conteudo_pub_pendentes: {
        Args: { p_segredo: string }
        Returns: {
          agendado_para: string
          criado_em: string
          id: string
          status: string
          zernio_post_id: string
        }[]
      }
      conteudo_pub_sincronizar: {
        Args: {
          p_erro: string
          p_id: string
          p_link: string
          p_segredo: string
          p_status: string
          p_zernio_post_id: string
        }
        Returns: boolean
      }
      conteudo_zernio_estado: { Args: { p_segredo: string }; Returns: string }
      conteudo_zernio_parear: { Args: { p_hash: string }; Returns: string }
      conteudo_zernio_reabrir: { Args: never; Returns: string }
      conteudo_zernio_segredo_ok: {
        Args: { p_segredo: string }
        Returns: boolean
      }
      criar_aluna_teste: { Args: never; Returns: Json }
      criar_aviso_aluna: {
        Args: {
          _aluna: string
          _nome: string
          _origem: string
          _origem_id: string
        }
        Returns: undefined
      }
      crm_acao: { Args: { _acao: string; _uid: string }; Returns: boolean }
      crm_acao_minha: { Args: { p_acao: string }; Returns: boolean }
      crm_acesso_conferir: {
        Args: {
          p_area: string
          p_nivel: number
          p_numero_id?: string
          p_phone?: string
        }
        Returns: boolean
      }
      crm_acoes: { Args: never; Returns: string[] }
      crm_acoes_validas: { Args: { _acoes: Json }; Returns: boolean }
      crm_ai_aplicar_tags_inicio: {
        Args: {
          p_agent_slug: string
          p_numero_id: string
          p_origem?: string
          p_phone: string
        }
        Returns: string[]
      }
      crm_ai_assumir: {
        Args: { p_numero_id: string; p_phone: string }
        Returns: string
      }
      crm_ai_enfileirar: {
        Args: {
          p_agent_slug: string
          p_atraso?: number
          p_debounce?: number
          p_numero_id: string
          p_phone: string
          p_teto?: number
        }
        Returns: number
      }
      crm_ai_fila_pegar: {
        Args: { p_limite?: number }
        Returns: {
          agent_slug: string
          contact_phone: string
          created_at: string
          id: number
          motivo: string | null
          n_mensagens: number
          numero_id: string | null
          pego_em: string | null
          primeira_msg_em: string
          responder_apos: string
          status: string
          tentativas: number
          ultima_msg_em: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_ai_fila"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_ai_pausar_por_humano: {
        Args: { p_numero_id: string; p_origem: string; p_phone: string }
        Returns: boolean
      }
      crm_ai_pode: { Args: never; Returns: boolean }
      crm_ai_ref_do_contato: { Args: { p_phone: string }; Returns: string }
      crm_ai_robo_tick: { Args: never; Returns: string }
      crm_ai_transferir_para_ia: {
        Args: { p_agent_slug: string; p_numero_id: string; p_phone: string }
        Returns: string
      }
      crm_alunas_programa_segmento: {
        Args: { p_programa: string }
        Returns: string
      }
      crm_alunas_recorte:
        | {
            Args: { p_situacao: string }
            Returns: {
              chave: string
              desde: string
              fontes: string[]
              nome: string
              programa: string
              telefone_e164: string
              ultima: string
              vencimento: string
            }[]
          }
        | {
            Args: { p_programa: string; p_situacao: string }
            Returns: {
              chave: string
              desde: string
              fontes: string[]
              nome: string
              programa: string
              telefone_e164: string
              ultima: string
              vencimento: string
            }[]
          }
      crm_alunas_telefones: {
        Args: { p_programa?: string; p_situacao: string }
        Returns: {
          telefone: string
        }[]
      }
      crm_areas: { Args: never; Returns: string[] }
      crm_areas_todas: { Args: { _nivel: string }; Returns: Json }
      crm_areas_validas: { Args: { _areas: Json }; Returns: boolean }
      crm_atendente_assumir_se_vazio: {
        Args: { p_numero_id: string; p_phone: string }
        Returns: boolean
      }
      crm_atendente_definir: {
        Args: { p_atendente_id: string; p_contato_id: string }
        Returns: string
      }
      crm_atendentes: {
        Args: never
        Returns: {
          id: string
          nome: string
        }[]
      }
      crm_automacoes_tick: { Args: never; Returns: string }
      crm_banco_atualizado_em: { Args: never; Returns: string }
      crm_banco_pode: { Args: never; Returns: boolean }
      crm_conversa_pode: {
        Args: {
          _nivel: number
          _numero_id: string
          _phone: string
          _uid: string
        }
        Returns: boolean
      }
      crm_conversas_contadores: {
        Args: {
          p_atendente?: string
          p_base?: string
          p_leituras?: Json
          p_marcadas?: string[]
          p_numero_id?: string
          p_ocultos?: string[]
        }
        Returns: Json
      }
      crm_conversas_pagina: {
        Args: {
          p_atendente?: string
          p_base?: string
          p_busca?: string
          p_chaves?: string[]
          p_cursor_em?: string
          p_cursor_id?: string
          p_desde?: string
          p_filtro?: string
          p_leituras?: Json
          p_limite?: number
          p_marcadas?: string[]
          p_numero_id?: string
          p_ocultos?: string[]
        }
        Returns: {
          consultado_em: string
          contato: Json
          nao_lidas: number
          ordem_em: string
          ultima: Json
        }[]
      }
      crm_conversas_ultimas: {
        Args: { p_base?: string; p_leituras?: Json }
        Returns: {
          contact_phone: string
          nao_lidas: number
          numero_id: string
          ultima: Json
          ultima_em: string
        }[]
      }
      crm_departamento_definir: {
        Args: { p_contato_id: string; p_departamento_id: string }
        Returns: string
      }
      crm_departamentos_importar: { Args: { p_lista: Json }; Returns: number }
      crm_eh_admin: { Args: { _uid: string }; Returns: boolean }
      crm_etapa_valida: { Args: { _slug: string }; Returns: boolean }
      crm_evento_banco: {
        Args: {
          p_dados: Json
          p_evento: string
          p_fonte: string
          p_phone: string
        }
        Returns: undefined
      }
      crm_evento_tem_ouvinte: {
        Args: { p_evento: string; p_fonte?: string }
        Returns: boolean
      }
      crm_eventos_disponiveis: {
        Args: never
        Returns: {
          total: number
          ultimo: string
          valor: string
        }[]
      }
      crm_fluxo_entrada_assinatura: {
        Args: { p_fluxo: string; p_ligar: boolean }
        Returns: string
      }
      crm_fluxo_entrada_bater: {
        Args: { p_id_publico: string }
        Returns: boolean
      }
      crm_fluxo_entrada_novo_token: {
        Args: { p_fluxo: string }
        Returns: string
      }
      crm_fluxos_resumo: {
        Args: never
        Returns: {
          enviados: number
          falhas: number
          fluxo_id: string
          inscritos_ativos: number
          respondidos: number
          total_inscritos: number
        }[]
      }
      crm_grupo_link_abrir: {
        Args: { p_slug: string; p_tipo?: string }
        Returns: string
      }
      crm_hoje_brt: { Args: never; Returns: string }
      crm_meu_acesso: { Args: never; Returns: Json }
      crm_meus_departamentos: { Args: { _uid: string }; Returns: string[] }
      crm_nivel: { Args: { _area: string; _uid: string }; Returns: number }
      crm_nome_chave: { Args: { bruto: string }; Returns: string }
      crm_numero_normalizar_nome: { Args: { p_nome: string }; Returns: string }
      crm_numero_padrao_id: { Args: never; Returns: string }
      crm_numero_renomear: {
        Args: { p_id: string; p_nome: string }
        Returns: {
          apelido: string
          chave: string
          id: string
          sessao_openwa: string
        }[]
      }
      crm_numeros_do_usuario: { Args: { _uid: string }; Returns: string[] }
      crm_padrao_permitido: { Args: { _uid: string }; Returns: boolean }
      crm_pode: {
        Args: { _areas: string[]; _nivel: number; _uid: string }
        Returns: boolean
      }
      crm_registrar_evento: {
        Args: {
          p_dados?: Json
          p_evento: string
          p_nome?: string
          p_phone: string
        }
        Returns: number
      }
      crm_segmento_contar: { Args: { p_slug: string }; Returns: number }
      crm_segmento_listar: {
        Args: {
          p_filtros?: Json
          p_pagina?: number
          p_por_pagina?: number
          p_slug: string
        }
        Returns: {
          chave: string
          comprador: boolean
          email: string
          nivel: string
          nome: string
          origens: string[]
          primeira_entrada: string
          produto: string
          programa: string
          tags: string[]
          telefone_e164: string
          total: number
          ultima_entrada: string
          vencimento: string
        }[]
      }
      crm_sem_acento: { Args: { t: string }; Returns: string }
      crm_so_departamentos: { Args: { _uid: string }; Returns: boolean }
      crm_so_minhas: { Args: { _uid: string }; Returns: boolean }
      crm_tag_criar: { Args: { p_nome: string }; Returns: string }
      crm_tag_normalizar: { Args: { p: string }; Returns: string }
      crm_tags_existentes: {
        Args: never
        Returns: {
          tag: string
          uso: number
          variantes: string[]
        }[]
      }
      crm_todos_numeros: { Args: { _uid: string }; Returns: boolean }
      crm_ve_todas_conversas: { Args: { _uid: string }; Returns: boolean }
      crm_ve_tudo: { Args: { _uid: string }; Returns: boolean }
      delete_user: { Args: { target_user_id: string }; Returns: undefined }
      delete_user_sem_checagem: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      dono_do_sistema: { Args: never; Returns: string }
      e_minha_aluna: { Args: { _aluna_id: string }; Returns: boolean }
      feedback_produto_do_programa: {
        Args: { p_programa: string }
        Returns: string
      }
      fullfunnel_conferir: { Args: never; Returns: number }
      fullfunnel_disparar: { Args: { p_envio_id: number }; Returns: undefined }
      fullfunnel_enfileirar: { Args: { p_lead_id: string }; Returns: undefined }
      fullfunnel_enviar_amostra: { Args: never; Returns: number }
      fullfunnel_payload: {
        Args: {
          p_teste?: boolean
          r: Database["public"]["Tables"]["lead_form_responses"]["Row"]
        }
        Returns: Json
      }
      get_public_booking_info: {
        Args: { p_date: string }
        Returns: {
          availability_overrides: Json
          availability_weekly: Json
          booked_slots_map: Json
          capacity_per_slot: number
          max_daily_bookings: number
          slot_gap_minutes: number
        }[]
      }
      google_pareamento_aceita: { Args: never; Returns: boolean }
      google_pareamento_gravar: {
        Args: { p_ip: string; p_nonce: string; p_valor: string }
        Returns: string
      }
      google_pareamento_reabrir: { Args: never; Returns: string }
      grupos_campanha_avulsa: { Args: { p_numero: string }; Returns: string }
      grupos_cancelar_mensagem: { Args: { p_id: string }; Returns: string }
      grupos_disparo_tick: { Args: never; Returns: string }
      grupos_link_lead: {
        Args: {
          p_campanha: string
          p_email: string
          p_nome: string
          p_tel: string
        }
        Returns: undefined
      }
      grupos_metricas_periodo: {
        Args: { p_desde: string }
        Returns: {
          campanha_id: string
          cliques: number
          cliques_grupo: number
          entradas: number
          saidas: number
        }[]
      }
      grupos_registrar_evento_membros: {
        Args: {
          p_chat_id: string
          p_chave: string
          p_participantes: string[]
          p_tipo: string
        }
        Returns: number
      }
      grupos_resolver_link: {
        Args: {
          p_email?: string
          p_espera?: string
          p_nome?: string
          p_slug: string
          p_tel?: string
          p_utm?: Json
        }
        Returns: Json
      }
      grupos_serie_diaria: {
        Args: { p_campanha: string; p_desde: string }
        Returns: {
          cliques: number
          dia: string
          entradas: number
          saidas: number
        }[]
      }
      grupos_tel_e164: { Args: { bruto: string }; Returns: string }
      grupos_telefones_ok: { Args: { t: string[] }; Returns: boolean }
      grupos_vagas: { Args: { p_campanha: string }; Returns: number }
      has_module: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      identificar_aluna_por_whatsapp: {
        Args: { p_telefone: string }
        Returns: {
          id: string
          nome_completo: string
          programa: string
        }[]
      }
      instagram_dados_meta: { Args: never; Returns: Json }
      instagram_pareamento_aceita: { Args: never; Returns: boolean }
      instagram_pareamento_gravar: {
        Args: { p_ip: string; p_nonce: string; p_valor: string }
        Returns: string
      }
      instagram_pareamento_reabrir: { Args: never; Returns: string }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      link_form_response_to_consultation: {
        Args: { p_consultation_id: string; p_form_response_id: string }
        Returns: undefined
      }
      link_latest_form_response_to_consultation: {
        Args: { p_consultation_id: string; p_telefone: string }
        Returns: string
      }
      live_agenda_tick: { Args: never; Returns: string }
      live_pareamento_aceita: { Args: never; Returns: boolean }
      live_pareamento_gravar: {
        Args: { p_ip: string; p_nonce: string; p_valor: string }
        Returns: string
      }
      live_pareamento_reabrir: { Args: never; Returns: string }
      mark_whatsapp_clicked: {
        Args: { p_consultation_id: string }
        Returns: boolean
      }
      meu_perfil_aluna: {
        Args: never
        Returns: {
          aluna_id: string
          data_vencimento: string
          nome_completo: string
          programa: string
        }[]
      }
      pagtrust_numero: { Args: { t: string }; Returns: number }
      pagtrust_pedido: { Args: { p: Json }; Returns: string }
      pagtrust_receber: { Args: { p: Json }; Returns: Json }
      pagtrust_status: { Args: { p: Json }; Returns: string }
      pagtrust_valor_bruto: { Args: { p: Json }; Returns: number }
      pode_alterar_consultas: { Args: { _user_id: string }; Returns: boolean }
      pode_comercial: { Args: { _user_id: string }; Returns: boolean }
      pode_gerir_aluna_teste: { Args: { _uid: string }; Returns: boolean }
      pode_lives: { Args: { _uid: string }; Returns: boolean }
      pode_ver_consultas: { Args: { _user_id: string }; Returns: boolean }
      profiles_nome_em_uso: {
        Args: { p_id: string; p_nome: string }
        Returns: boolean
      }
      rotator_compra_manual: {
        Args: {
          p_click: string
          p_pedido?: string
          p_quando?: string
          p_valor: number
        }
        Returns: string
      }
      rotator_otim_gamma: { Args: { shape: number }; Returns: number }
      rotator_otim_pesos: {
        Args: { piso: number; probs: number[]; sem_teto: boolean; teto: number }
        Returns: number[]
      }
      rotator_otimizar: {
        Args: { p_forcar?: boolean; p_rotator: string }
        Returns: Json
      }
      rotator_otimizar_todos: { Args: never; Returns: number }
      telefone_ddd: { Args: { _tel: string }; Returns: string }
      telefone_e164: { Args: { p_bruto: string }; Returns: string }
      telefone_local: { Args: { _tel: string }; Returns: string }
      telefone_nucleo: { Args: { _tel: string }; Returns: string }
      tem_tarefa_da_consulta: {
        Args: { _consulta: string; _user_id: string }
        Returns: boolean
      }
      track_webinar_progress: {
        Args: {
          p_clicked_cta?: boolean
          p_seconds?: number
          p_session_id: string
        }
        Returns: undefined
      }
      vincular_meu_acesso: { Args: never; Returns: string }
      wa_pareamento_consumir: { Args: { p_ip: string }; Returns: boolean }
      wa_pareamento_estado: {
        Args: never
        Returns: {
          aberto_ate: string
          pareado_em: string
          pareado_ip: string
        }[]
      }
      wa_pareamento_reabrir: { Args: { p_minutos?: number }; Returns: string }
      webinar_broadcast: {
        Args: { p_evento: string; p_payload: Json; p_sessao: string }
        Returns: undefined
      }
      webinar_chat_enviar: {
        Args: { p_texto: string; p_token: string }
        Returns: Json
      }
      webinar_chat_recentes: {
        Args: { p_depois_de?: number; p_token: string }
        Returns: {
          autor_nome: string
          created_at: string
          fixada: boolean
          id: number
          papel: string
          texto: string
        }[]
      }
      webinar_lembrete_quando: {
        Args: { p_inicio: string; p_tipo: string }
        Returns: string
      }
      webinar_lembretes_tick: { Args: never; Returns: string }
      webinar_publico: { Args: { p_slug: string }; Returns: Json }
      webinar_reg_do_token: { Args: { p_token: string }; Returns: string }
      webinar_token_de: { Args: { p_reg: string }; Returns: string }
      pagtrust_webhook_SEU_NOME_SECRETO: { Args: { "": Json }; Returns: Json }
      whatsapp_aplicar_nomes: { Args: { p_nomes: Json }; Returns: number }
      whatsapp_avatars_pendentes: {
        Args: { p_dias?: number; p_limite?: number }
        Returns: {
          numero_id: string
          phone: string
        }[]
      }
      whatsapp_avatars_tick: { Args: never; Returns: string }
      whatsapp_backfill_tick: { Args: never; Returns: string }
      whatsapp_inserir_mensagens: { Args: { p_linhas: Json }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user" | "sdr" | "closer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "sdr", "closer"],
    },
  },
} as const
